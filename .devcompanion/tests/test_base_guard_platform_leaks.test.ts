import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  load, graphPath, requestApproval, writeWorklist, readWorklist,
} from "../../companion/ideas.js";
import {
  normalizeClaude, normalizeCursor, normalizeCodex,
  encodeClaude, encodeCursor, encodeCodex,
  decide, resolvePlatform, sessionBriefing,
} from "../../companion/guard.js";

// H8 / H8b / 审计第 9 节 —— 四处平台知识漏在适配层外面。判据全是 D22（规则核心
// 只见归一化事件）和 D15（回包形状各家不同，摆在哪由 encoder 说了算）：
//   (a) 批准回执被入口直接写进 stdout，Cursor 于是先收一段纯文本再收一段 JSON，
//       一条流上两份文档，它的解析器读不了。
//   (b) 划掉扫描清单那一步认的是 Claude 的原始字段名 PostToolUse / Read，
//       Cursor 和 Codex 的读永远划不掉一行。
//   (c) 会话简报只在 Claude 的 manifest 里当特例接给了 status，Cursor 的
//       sessionStart 和 Codex 的 SessionStart 打到守卫，而守卫没有这类事件。
//   (d) 认不出来的 --platform 悄悄退回 Claude 语义 —— 接线里一个拼写错误就变成
//       用别家听不懂的退出码放行。
describe("companion guard platform leaks (H8/H8b)", () => {
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

  const run = (platform: string, raw: unknown) => spawnSync(
    "npx", ["tsx", GUARD, `--platform=${platform}`],
    { input: JSON.stringify(raw), encoding: "utf8", shell: process.platform === "win32", timeout: 120_000 },
  );

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "leaks-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
    writeFileSync(join(dir, "src", "a.ts"), "// fixture\n");
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  // ── (a) 批准回执坐在判决里，摆哪由 encoder 决定 ───────────────────────────

  it("the approval receipt rides in the verdict, and each encoder places it itself", () => {
    const message = "Companion：批准已记录（plan）。";
    const prompt = normalizeClaude({ hook_event_name: "UserPromptSubmit", prompt: "批准 CC-1", cwd: dir });

    const claude = encodeClaude(prompt, { allow: true, message });
    expect(claude.exitCode).toBe(0);
    expect(claude.stdout).toMatch(/批准已记录/);

    const cursor = encodeCursor({ ...prompt, event: "prompt" }, { allow: true, message });
    const body = JSON.parse(cursor.stdout!);
    expect(body.continue).toBe(true);
    expect(JSON.stringify(body)).toMatch(/批准已记录/);

    const codex = encodeCodex(prompt, { allow: true, message });
    expect(codex.stdout).toMatch(/批准已记录/);
  });

  it("end to end: cursor's prompt reply is ONE json document, not text then json", { timeout: 120_000 }, () => {
    const { challenge } = requestApproval(dir, load(graphPath(dir)).graph, "plan", ["I-001"]);
    const r = run("cursor", { hook_event_name: "beforeSubmitPrompt", prompt: `批准 ${challenge}`, cwd: dir });
    const out = (r.stdout ?? "").trim();
    expect(out.length).toBeGreaterThan(0);
    expect(() => JSON.parse(out), `stdout was: ${out}`).not.toThrow();   // 纯文本 + JSON 会在这里炸
    expect(JSON.parse(out).continue).toBe(true);
  });

  // ── (b) 读事件归一化，三家的读都能划掉清单 ────────────────────────────────

  it("all three hosts' reads normalize to the read kind, carrying the file", () => {
    const events = [
      normalizeClaude({ hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "src/a.ts" }, cwd: dir }),
      normalizeCursor({ hook_event_name: "beforeReadFile", file_path: "src/a.ts", cwd: dir }),
      normalizeCodex({ hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "src/a.ts" }, cwd: dir }),
    ];
    for (const event of events) {
      expect(event.event, JSON.stringify(event)).toBe("read");
      expect(event.paths).toEqual(["src/a.ts"]);
      expect(decide(event, dir).allow).toBe(true);       // 读从来不是可拦的东西
    }
  });

  it("end to end: a cursor read strikes the scan worklist, same as a claude read", { timeout: 120_000 }, () => {
    writeWorklist(dir, ["src/a.ts"]);
    expect(readWorklist(dir)).toEqual(["src/a.ts"]);
    run("cursor", { hook_event_name: "beforeReadFile", file_path: join(dir, "src", "a.ts"), cwd: dir });
    expect(readWorklist(dir)).toEqual([]);
  });

  // ── (c) 会话简报是归一化事件，不是 Claude 的 manifest 特例 ─────────────────

  it("all three hosts' session events normalize to one session kind", () => {
    for (const event of [
      normalizeClaude({ hook_event_name: "SessionStart", cwd: dir }),
      normalizeCursor({ hook_event_name: "sessionStart", cwd: dir }),
      normalizeCodex({ hook_event_name: "SessionStart", cwd: dir }),
    ]) {
      expect(event.event, JSON.stringify(event)).toBe("session");
      expect(decide(event, dir).allow).toBe(true);
    }
  });

  it("the briefing is the engine's own status table, and every encoder delivers it", () => {
    const message = sessionBriefing(dir);
    expect(message).toMatch(/I-001/);
    expect(message).toMatch(/doing/);

    const session = { event: "session" as const, cwd: dir };
    expect(encodeClaude(session, { allow: true, message })).toMatchObject({ exitCode: 0 });
    expect(encodeClaude(session, { allow: true, message }).stdout).toMatch(/I-001/);
    expect(JSON.parse(encodeCursor(session, { allow: true, message }).stdout!).additional_context).toMatch(/I-001/);
    expect(encodeCodex(session, { allow: true, message }).stdout).toMatch(/I-001/);
  });

  it("no graph, no briefing — a session opener never blocks a session", () => {
    const bare = mkdtempSync(join(tmpdir(), "leaks-bare-"));
    dirs.push(bare);
    expect(sessionBriefing(bare)).toBeUndefined();
    expect(encodeCursor({ event: "session" }, { allow: true }).stdout).toBe("{}");
  });

  // ── (d) 认不出来的平台大声拒绝，不悄悄退回 Claude ──────────────────────────

  it("an unrecognised --platform resolves to nothing instead of falling back to claude", () => {
    expect(resolvePlatform([])).toBe("claude");
    expect(resolvePlatform(["--platform=cursor"])).toBe("cursor");
    expect(resolvePlatform(["--platform=codex"])).toBe("codex");
    expect(resolvePlatform(["--platform=cursur"])).toBeNull();
    expect(resolvePlatform(["--platform="])).toBeNull();
    // 原型上的键不是平台：`in` 会把 constructor 当成认得的名字，然后拿 Object
    // 当归一化器用 —— 每个事件都答成空，等于静默放行。
    expect(resolvePlatform(["--platform=constructor"])).toBeNull();
    expect(resolvePlatform(["--platform=toString"])).toBeNull();
  });

  it("end to end: the guard exits non-zero and says so on an unknown platform", { timeout: 120_000 }, () => {
    const r = run("cursur", { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "src/x.ts" }, cwd: dir });
    expect(r.status).not.toBe(0);
    expect(`${r.stderr}`).toMatch(/cursur/);
  });
});
