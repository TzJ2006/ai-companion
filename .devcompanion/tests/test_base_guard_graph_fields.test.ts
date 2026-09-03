import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { normalizeClaude, normalizeCursor, normalizeCodex, decide } from "../../companion/guard.js";

// H1 — 图那条规则原来是「拿不到改后内容就放行」：Codex 的 apply_patch 只带
// operations 不带 edit，Cursor 的 ApplyPatch/EditNotebook 带一个字段全空的
// edit，任何平台的 MCP 写压根没有 edit。于是 D24/D27 单独点名保护的 status 和
// signed_off，实际上只在 Claude 形状的 Edit/Write 上被守着。补法有两条：图是
// 目标又拿不出改后内容就拒绝（去用 set / manual-check 口令）；补丁能读到文本就
// 逐行看 status/signed_off 的增删。只改叙述的补丁必须照旧放行 —— 图仍然是可
// 编辑的散文，这正是 R2 存在的理由。
describe("companion guard graph fields without an edit body (H1)", () => {
  let dir: string;
  const dirs: string[] = [];

  const yaml = `version: 1
project: fixture
endpoints: [I-001]
ideas:
  - id: I-001
    name: "进行中的想法"
    status: doing
    needs: []
    what: W
    why: Y
    expected: E
    how: H
    why_this_way: T
    future: F
    code:
      - file: src/a.ts
    verify:
      command: "node checker.cjs"
      test_files: [ tests/a.test.txt ]
      pass: "exit 0"
`;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "graphfields-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  const codexPatch = (...lines: string[]) => normalizeCodex({
    hook_event_name: "PreToolUse", tool_name: "apply_patch",
    tool_input: { command: ["*** Begin Patch", "*** Update File: ideas/graph.yaml", ...lines, "*** End Patch"].join("\n") },
    cwd: dir,
  });

  const cursorPatch = (...lines: string[]) => normalizeCursor({
    hook_event_name: "preToolUse", tool_name: "ApplyPatch",
    tool_input: { path: "ideas/graph.yaml", patch: ["--- a/ideas/graph.yaml", "+++ b/ideas/graph.yaml", ...lines].join("\n") },
    cwd: dir,
  });

  // ── 补丁里的 status / signed_off 逐行看得见 ──────────────────────────────

  it("codex: a status flip buried in an apply_patch hunk is denied, and points at set", () => {
    const v = decide(codexPatch("@@", "-    status: doing", "+    status: done"), dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/set/);
  });

  it("codex: a signature added by patch is denied, and points at the manual-check challenge", () => {
    const v = decide(codexPatch("@@", "+      signed_off: 张三看过了"), dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/manual-check/);
  });

  it("cursor: the same status flip in a unified diff is denied — the ---/+++ headers are not hunk lines", () => {
    const v = decide(cursorPatch("@@ -6,1 +6,1 @@", "-    status: doing", "+    status: done"), dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/set/);
  });

  // ── 只改叙述的补丁照旧放行（R2：图是可编辑的散文） ───────────────────────

  it("a prose-only patch on the graph still goes through, on codex and cursor alike", () => {
    expect(decide(codexPatch("@@", "-    how: H", "+    how: 换一种写法"), dir).allow).toBe(true);
    expect(decide(cursorPatch("@@ -9,1 +9,1 @@", "-    why: Y", "+    why: 换个理由"), dir).allow).toBe(true);
  });

  it("a reworded plan that merely mentions the field name is prose, not a field change", () => {
    const v = decide(codexPatch("@@", "-    how: H", "+    how: 改 status: 一律走 set，不手改"), dir);
    expect(v.allow).toBe(true);
  });

  // ── 拿不出改后内容 = 拒绝，不是放行 ──────────────────────────────────────

  it("claude: an MCP write onto the graph carries no edit body at all — denied", () => {
    const event = normalizeClaude({
      hook_event_name: "PreToolUse", tool_name: "mcp__filesystem__write_file",
      tool_input: { path: "ideas/graph.yaml" }, cwd: dir,
    });
    expect(event.event).toBe("pre-write");
    const v = decide(event, dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/set|manual-check/);
  });

  it("cursor: an EditNotebook-shaped write on the graph shows nothing — denied", () => {
    const event = normalizeCursor({
      hook_event_name: "preToolUse", tool_name: "EditNotebook",
      tool_input: { path: "ideas/graph.yaml", new_source: "status: done" }, cwd: dir,
    });
    const v = decide(event, dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/set|manual-check/);
  });

  it("codex: a Write onto the graph with no content is denied too", () => {
    const event = normalizeCodex({
      hook_event_name: "PreToolUse", tool_name: "Write",
      tool_input: { file_path: "ideas/graph.yaml" }, cwd: dir,
    });
    const v = decide(event, dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/set|manual-check/);
  });

  // ── Claude 形状的编辑一如既往 ───────────────────────────────────────────

  it("claude: an ordinary Edit on the graph is unchanged — prose passes, a status flip does not", () => {
    const edit = (old_string: string, new_string: string) => normalizeClaude({
      hook_event_name: "PreToolUse", tool_name: "Edit",
      tool_input: { file_path: join(dir, "ideas", "graph.yaml"), old_string, new_string }, cwd: dir,
    });
    expect(decide(edit("why: Y", "why: 换个理由"), dir).allow).toBe(true);
    expect(decide(edit("status: doing", "status: done"), dir).allow).toBe(false);
  });

  it("the ledger's other files are untouched by this rule", () => {
    const event = normalizeCodex({
      hook_event_name: "PreToolUse", tool_name: "apply_patch",
      tool_input: { command: ["*** Begin Patch", "*** Update File: ideas/log.md", "+- 2026-09-02  写了点东西", "*** End Patch"].join("\n") },
      cwd: dir,
    });
    expect(decide(event, dir).allow).toBe(true);
  });
});
