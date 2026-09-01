import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  load, graphPath, paths, requestApproval,
} from "../../companion/ideas.js";
import {
  normalizeClaude, normalizeCursor, normalizeCodex,
  encodeClaude, encodeCursor, encodeCodex,
  decide, handlePrompt,
} from "../../companion/guard.js";

// I-094 — 三家的 hook 事件各翻译成同一种归一化事件进规则核心，判决再各翻译回
// 各家听得懂的回答。同一种越界行为，三家 fixture 必须得到同一个拒绝；apply_patch
// 一个补丁里的每个文件都被检查；走 MCP 的写不再绕过守卫；Codex 回包永不出现
// ask（官方明确写前不支持，回 ask 等于放行）。裁决依据：D15/D22。
describe("companion platform adapters (I-094)", () => {
  let dir: string;
  const dirs: string[] = [];
  const GUARD = resolve(fileURLToPath(import.meta.url), "../../../companion/guard.ts");

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
    dir = mkdtempSync(join(tmpdir(), "adapt-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  // ── 同一种越界写，三家同判 ───────────────────────────────────────────────

  it("the same out-of-scope write is denied identically across all three platforms", () => {
    const claude = normalizeClaude({
      hook_event_name: "PreToolUse", tool_name: "Write",
      tool_input: { file_path: join(dir, "src", "x.ts"), content: "x" }, cwd: dir,
    });
    const cursor = normalizeCursor({
      hook_event_name: "preToolUse", tool_name: "Write",
      tool_input: { path: "src/x.ts" }, cwd: dir,
    });
    const codex = normalizeCodex({
      hook_event_name: "PreToolUse", tool_name: "apply_patch",
      tool_input: { command: "*** Begin Patch\n*** Update File: src/x.ts\n+x\n*** End Patch" }, cwd: dir,
    });
    for (const event of [claude, cursor, codex]) {
      expect(event.event).toBe("pre-write");
      expect(decide(event, dir).allow, JSON.stringify(event)).toBe(false);
    }
  });

  it("each platform's deny travels in its own wire format", () => {
    const deny = { allow: false, reason: "越界" };
    const preClaude = normalizeClaude({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "src/x.ts" }, cwd: dir });

    const c = encodeClaude(preClaude, deny);
    expect(c.exitCode).toBe(2);
    expect(JSON.parse(c.stdout!).hookSpecificOutput.permissionDecision).toBe("deny");

    const u = encodeCursor(preClaude, deny);
    expect(u.exitCode).toBe(0);                              // Cursor 的判决在 JSON 里，不在退出码里
    expect(JSON.parse(u.stdout!).permission).toBe("deny");

    const x = encodeCodex(preClaude, deny);
    expect(JSON.parse(x.stdout!).hookSpecificOutput.permissionDecision).toBe("deny");
    expect(x.stdout).not.toMatch(/"ask"/);
  });

  it("codex encoder never says ask — allow or deny only", () => {
    const pre = normalizeCodex({ hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "tests/a.test.txt" }, cwd: dir });
    for (const verdict of [{ allow: true }, { allow: false, reason: "r" }]) {
      const reply = encodeCodex(pre, verdict);
      expect(reply.stdout ?? "").not.toMatch(/"ask"/);
    }
  });

  // ── apply_patch：每个文件都检查，缺一个解析整单拒绝 ──────────────────────

  it("a multi-file patch is checked file by file — one bad file refuses the batch", () => {
    const event = normalizeCodex({
      hook_event_name: "PreToolUse", tool_name: "apply_patch",
      tool_input: { command: [
        "*** Begin Patch",
        "*** Update File: tests/a.test.txt",   // 合法：doing 想法的测试文件
        "+assert",
        "*** Add File: src/evil.ts",           // 越界
        "+x",
        "*** End Patch",
      ].join("\n") }, cwd: dir,
    });
    expect(event.operations?.length).toBe(2);
    expect(decide(event, dir).allow).toBe(false);
  });

  it("a patch that parses to nothing is an unknown target, and unknown means deny", () => {
    const event = normalizeCodex({
      hook_event_name: "PreToolUse", tool_name: "apply_patch",
      tool_input: { command: "*** Begin Patch\ngarbled nonsense\n*** End Patch" }, cwd: dir,
    });
    expect(event.unknownTarget).toBe(true);
    expect(decide(event, dir).allow).toBe(false);
  });

  // ── MCP 不再是旁路 ───────────────────────────────────────────────────────

  it("an MCP write tool with a path is policed like any write", () => {
    const event = normalizeCodex({
      hook_event_name: "PreToolUse", tool_name: "mcp__filesystem__write_file",
      tool_input: { path: "src/x.ts", content: "x" }, cwd: dir,
    });
    expect(event.event).toBe("pre-write");
    expect(decide(event, dir).allow).toBe(false);
  });

  it("an MCP write tool hiding its path is denied as unknown, a read tool passes", () => {
    const write = normalizeCodex({
      hook_event_name: "PreToolUse", tool_name: "mcp__filesystem__write_file",
      tool_input: { blob: "???" }, cwd: dir,
    });
    expect(decide(write, dir).allow).toBe(false);

    const read = normalizeCodex({
      hook_event_name: "PreToolUse", tool_name: "mcp__db__query",
      tool_input: { sql: "select 1" }, cwd: dir,
    });
    expect(decide(read, dir).allow).toBe(true);
  });

  it("cursor's beforeMCPExecution carries tool_input as a JSON string — still policed", () => {
    const event = normalizeCursor({
      hook_event_name: "beforeMCPExecution", tool_name: "mcp__fs__edit_file",
      tool_input: JSON.stringify({ file_path: "src/x.ts" }), mcp_server_name: "fs", cwd: dir,
    });
    expect(event.event).toBe("pre-write");
    expect(decide(event, dir).allow).toBe(false);
  });

  // ── shell 与 stop 在各家的形状 ───────────────────────────────────────────

  it("cursor's beforeShellExecution redirect is denied in the flat permission format", () => {
    const event = normalizeCursor({
      hook_event_name: "beforeShellExecution", command: "echo x > src/a.ts", cwd: dir,
    });
    const verdict = decide(event, dir);
    expect(verdict.allow).toBe(false);
    expect(JSON.parse(encodeCursor(event, verdict).stdout!).permission).toBe("deny");
  });

  it("stop blocks per platform: claude via exit 2, cursor via followup_message", () => {
    writeFileSync(graphPath(dir), yaml.replace("needs: []", "needs: [I-999]"));
    const claude = normalizeClaude({ hook_event_name: "Stop", cwd: dir, stop_hook_active: false });
    const vc = decide(claude, dir);
    expect(vc.allow).toBe(false);
    expect(encodeClaude(claude, vc).exitCode).toBe(2);

    const cursor = normalizeCursor({ hook_event_name: "stop", status: "completed", loop_count: 0, cwd: dir });
    const vu = decide(cursor, dir);
    expect(vu.allow).toBe(false);
    expect(JSON.parse(encodeCursor(cursor, vu).stdout!).followup_message).toBeTruthy();
  });

  // ── 批准消费：三家的人类消息都走同一个 applyApproval ─────────────────────

  it("a challenge answer consumes through cursor's beforeSubmitPrompt and claude's UserPromptSubmit alike", () => {
    const { challenge } = requestApproval(dir, load(graphPath(dir)).graph, "decomposition");
    const viaCursor = normalizeCursor({ hook_event_name: "beforeSubmitPrompt", prompt: `批准 ${challenge}`, cwd: dir });
    const outcome = handlePrompt(viaCursor, dir);
    expect(outcome?.ok).toBe(true);
    expect(existsSync(join(paths(dir).runtime, "approvals", `${challenge}.json`))).toBe(true);

    const again = requestApproval(dir, load(graphPath(dir)).graph, "decomposition");
    const viaClaude = normalizeClaude({ hook_event_name: "UserPromptSubmit", prompt: `APPROVE ${again.challenge}`, cwd: dir, session_id: "s", turn_id: "t" });
    expect(handlePrompt(viaClaude, dir)?.ok).toBe(true);
  });

  // ── 真跑一遍入口：stdin 进，退出码出 ─────────────────────────────────────

  it("end to end: a violating claude event piped into the entry exits 2", { timeout: 60_000 }, () => {
    const input = JSON.stringify({
      hook_event_name: "PreToolUse", tool_name: "Write",
      tool_input: { file_path: join(dir, "src", "x.ts"), content: "x" }, cwd: dir,
    });
    const r = spawnSync("npx", ["tsx", GUARD, "--platform=claude"], {
      input, encoding: "utf8", shell: process.platform === "win32", timeout: 120_000,
    });
    expect(r.status).toBe(2);
    expect(`${r.stderr}${r.stdout}`).toMatch(/D16|认领|进行中/);
  });
});
