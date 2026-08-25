import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import {
  decide, ideaFor, testFileOf, loadGraph, graphHash, isApproval, approvalFile,
  type HookInput,
} from "../../claude-companion/guard.js";
import { graphPath, readWorklist, writeWorklist, worklistFile, check } from "../../claude-companion/ideas.js";

// The five enforcement rules. See claude-companion/guard.ts.
describe("guard", () => {
  let dir: string;
  const dirs: string[] = [];

  const GRAPH = `version: 1
agent: claude
project: fixture
endpoints: [I-002]
ideas:
  - id: I-001
    name: "有测试的想法"
    status: todo
    needs: []
    what: W
    why: Y
    expected: E
    how: H
    why_this_way: T
    future: F
    code:
      - file: src/thing.ts
        symbol: thing
    verify: { command: "npx vitest run tests/thing.test.ts", pass: "exit 0" }
  - id: I-002
    name: "没想清楚的想法"
    status: todo
    needs: [I-001]
    what: W2
    why: Y2
    expected: E2
    future: F2
    code:
      - file: src/vague.ts
        symbol: vague
    verify: { command: "npx vitest run tests/vague.test.ts", pass: "exit 0" }
`;

  // Writing the graph invalidates any approval, so keep them in sync by default;
  // the R6 tests below break that sync deliberately.
  const writeGraph = (text = GRAPH) => {
    mkdirSync(join(dir, "ideas"), { recursive: true });
    writeFileSync(graphPath(dir), text);
    writeFileSync(approvalFile(dir), `${graphHash(dir)}  approved 2026-08-24\n`);
  };
  const edit = (file: string, old = "a", next = "b"): HookInput => ({
    hook_event_name: "PreToolUse",
    tool_name: "Edit",
    tool_input: { file_path: join(dir, file), old_string: old, new_string: next },
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "guard-"));
    dirs.push(dir);
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeGraph();
    delete process.env.AIDEV_GUARD;
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  it("does nothing in a repo with no graph", () => {
    rmSync(join(dir, "ideas"), { recursive: true, force: true });
    expect(loadGraph(dir)).toBeNull();
    expect(decide(edit("src/thing.ts"), dir).block).toBe(false);
  });

  it("does nothing for a file no idea claims", () => {
    expect(ideaFor(loadGraph(dir)!, dir, join(dir, "src/other.ts"))).toBeUndefined();
    expect(decide(edit("src/other.ts"), dir).block).toBe(false);
  });

  // ── R1 记录 ──────────────────────────────────────────────────────────────
  it("R1 records every edit without blocking, naming the idea it belongs to", () => {
    const result = decide({
      hook_event_name: "PostToolUse", tool_name: "Write",
      tool_input: { file_path: join(dir, "src/thing.ts") },
    }, dir);
    expect(result.block).toBe(false);
    expect(result.log).toBe("Write src/thing.ts  → I-001 有测试的想法");
  });

  // ── R2 status 只能走 set ─────────────────────────────────────────────────
  it("R2 blocks a hand-edited status flip on an existing idea", () => {
    const result = decide(edit(relative(dir, graphPath(dir)), "status: todo\n    needs: []", "status: done\n    needs: []"), dir);
    expect(result.block).toBe(true);
    expect(result.message).toMatch(/I-001: todo → done/);
    expect(result.message).toMatch(/ideas\.ts"? set I-001 done/);   // path is quoted
  });

  it("R2 allows adding a new idea, and allows edits that leave statuses alone", () => {
    const added = GRAPH + `  - id: I-003
    name: "新想法"
    status: todo
    needs: []
`;
    expect(decide({
      hook_event_name: "PreToolUse", tool_name: "Write",
      tool_input: { file_path: graphPath(dir), content: added },
    }, dir).block).toBe(false);

    expect(decide(edit(relative(dir, graphPath(dir)), "what: W\n", "what: W 改了措辞\n"), dir).block).toBe(false);
  });

  // ── R3 测试先行 ──────────────────────────────────────────────────────────
  it("R3 blocks writing the code while its test file does not exist", () => {
    const result = decide(edit("src/thing.ts"), dir);
    expect(result.block).toBe(true);
    expect(result.message).toMatch(/测试先行/);
    expect(result.message).toMatch(/tests\/thing\.test\.ts/);
  });

  it("R3 allows the code once the test exists", () => {
    writeFileSync(join(dir, "tests", "thing.test.ts"), "// written first\n");
    expect(decide(edit("src/thing.ts"), dir).block).toBe(false);
  });

  it("R3 never blocks a manual check or an unparseable verify command", () => {
    writeGraph(GRAPH.replace(
      `verify: { command: "npx vitest run tests/thing.test.ts", pass: "exit 0" }`,
      `verify: { manual: "人看一眼", signed_off: null }`));
    expect(testFileOf(loadGraph(dir)!.ideas[0])).toBeUndefined();
    expect(decide(edit("src/thing.ts"), dir).block).toBe(false);
  });

  it("R3 stops guarding an idea once it is done", () => {
    writeGraph(GRAPH.replace(`name: "有测试的想法"\n    status: todo`, `name: "有测试的想法"\n    status: done`));
    expect(decide(edit("src/thing.ts"), dir).block).toBe(false);
  });

  // ── R4 先想清楚 ──────────────────────────────────────────────────────────
  it("R4 blocks an idea with no how / why_this_way, before R3 even applies", () => {
    writeFileSync(join(dir, "tests", "vague.test.ts"), "// test exists, still blocked\n");
    const result = decide(edit("src/vague.ts"), dir);
    expect(result.block).toBe(true);
    expect(result.message).toMatch(/还没想清楚/);
    expect(result.message).toMatch(/how \/ why_this_way/);
    expect(result.message).toMatch(/ccthink/);
  });

  // ── R5 图不能坏 ──────────────────────────────────────────────────────────
  it("R5 blocks the turn from ending while check reports errors", () => {
    // I-001 is done but its code file does not exist — check calls that an error.
    writeGraph(GRAPH.replace(`name: "有测试的想法"\n    status: todo`, `name: "有测试的想法"\n    status: done`));
    const result = decide({ hook_event_name: "Stop" }, dir);
    expect(result.block).toBe(true);
    expect(result.message).toMatch(/code file not found/);
  });

  it("R5 lets a sound graph end the turn", () => {
    // Both ideas are still todo, so their planned code files need not exist yet.
    expect(decide({ hook_event_name: "Stop" }, dir).block).toBe(false);
  });

  it("R5 stands down when it already blocked once, so it cannot loop", () => {
    writeGraph(GRAPH.replace(`name: "有测试的想法"\n    status: todo`, `name: "有测试的想法"\n    status: done`));
    expect(decide({ hook_event_name: "Stop", stop_hook_active: true }, dir).block).toBe(false);
  });

  // ── R6 等人审核 ──────────────────────────────────────────────────────────
  it("R6 blocks implementation of a graph no human has approved", () => {
    writeFileSync(join(dir, "tests", "thing.test.ts"), "// test first, done\n");
    rmSync(approvalFile(dir), { force: true });

    const result = decide(edit("src/thing.ts"), dir);
    expect(result.block).toBe(true);
    expect(result.message).toMatch(/还没有人审核过/);
    expect(result.message).toMatch(/批准/);
  });

  it("R6 accepts approval only from a UserPromptSubmit event, and then allows the write", () => {
    writeFileSync(join(dir, "tests", "thing.test.ts"), "// test first, done\n");
    rmSync(approvalFile(dir), { force: true });

    const approval = decide({ hook_event_name: "UserPromptSubmit", prompt: "  批准 " }, dir);
    expect(approval.block).toBe(false);
    expect(approval.approve).toBe(graphHash(dir));
    expect(approval.log).toMatch(/人工批准/);

    writeFileSync(approvalFile(dir), `${approval.approve}\n`);
    expect(decide(edit("src/thing.ts"), dir).block).toBe(false);
  });

  it("R6 re-blocks after the graph changes, because nobody approved that version", () => {
    writeFileSync(join(dir, "tests", "thing.test.ts"), "// test first, done\n");
    expect(decide(edit("src/thing.ts"), dir).block).toBe(false);   // approved by writeGraph

    const stale = graphHash(dir)!;
    writeFileSync(graphPath(dir), GRAPH.replace("what: W\n", "what: W 改了\n"));
    expect(graphHash(dir)).not.toBe(stale);

    const result = decide(edit("src/thing.ts"), dir);
    expect(result.block).toBe(true);
    expect(result.message).toMatch(/被改过了/);
    expect(result.message).toMatch(stale);
  });

  it("only a message that IS the approval counts — a negation never does", () => {
    for (const yes of ["批准", "approve", "Approved.", " 同意 ", "/ccgraph approve"]) {
      expect(isApproval(yes)).toBe(true);
    }
    for (const no of ["我不批准", "先别批准", "approve 之前先看看", "这个方案不同意", ""]) {
      expect(isApproval(no)).toBe(false);
    }
  });

  it("an agent cannot approve on the human's behalf — no tool event grants approval", () => {
    rmSync(approvalFile(dir), { force: true });
    // The word appearing in a tool call, a log, or a Stop event grants nothing.
    for (const event of ["PreToolUse", "PostToolUse", "Stop"]) {
      expect(decide({ hook_event_name: event, prompt: "批准", tool_name: "Edit" }, dir).approve).toBeUndefined();
    }
    expect(decide(edit("src/thing.ts"), dir).block).toBe(true);
  });

  // ── R7 真读完 ────────────────────────────────────────────────────────────
  it("R7 crosses a file off the scan worklist only when it is actually Read", () => {
    writeWorklist(dir, ["src/thing.ts", "src/vague.ts", "README.md"]);

    const result = decide({
      hook_event_name: "PostToolUse", tool_name: "Read",
      tool_input: { file_path: join(dir, "src/thing.ts") },
    }, dir);

    expect(result.block).toBe(false);
    expect(result.log).toBe("读 src/thing.ts  (扫描还剩 2)");
    expect(readWorklist(dir)).toEqual(["src/vague.ts", "README.md"]);
  });

  it("R7 ignores tools that do not put the file's content in context", () => {
    writeWorklist(dir, ["src/thing.ts"]);
    for (const tool of ["Edit", "Write", "Grep", "Glob"]) {
      decide({
        hook_event_name: "PostToolUse", tool_name: tool,
        tool_input: { file_path: join(dir, "src/thing.ts") },
      }, dir);
    }
    expect(readWorklist(dir)).toEqual(["src/thing.ts"]);   // still owed
  });

  it("R7 does nothing when no scan is running, and never strikes twice", () => {
    rmSync(worklistFile(dir), { force: true });
    const read = (file: string) => decide({
      hook_event_name: "PostToolUse", tool_name: "Read",
      tool_input: { file_path: join(dir, file) },
    }, dir);
    expect(read("src/thing.ts").log).toBeUndefined();      // no worklist → plain edit logging

    writeWorklist(dir, ["src/thing.ts"]);
    expect(read("src/thing.ts").log).toMatch(/扫描还剩 0/);
    expect(read("src/thing.ts").log).toBeUndefined();      // already struck
    expect(readWorklist(dir)).toEqual([]);
  });

  it("check warns while the scan is unfinished, and stops once it is", () => {
    writeWorklist(dir, ["src/a.ts", "src/b.ts"]);
    expect(check(loadGraph(dir)!, dir).warnings.join()).toMatch(/还有 2 个文件没被读过/);
    writeWorklist(dir, []);
    expect(check(loadGraph(dir)!, dir).warnings.join()).not.toMatch(/没被读过/);
  });

  // ── R6/R7 的账本本身不能被写 ──────────────────────────────────────────────
  it("refuses to let the agent author the approval or the scan worklist", () => {
    // These files are conclusions the agent must earn: one says a human signed
    // off, the other says how much is still unread. Writing them forges both.
    for (const [path, pattern] of [
      [approvalFile(dir), /R6/],
      [worklistFile(dir), /R7/],
    ] as [string, RegExp][]) {
      const result = decide({
        hook_event_name: "PreToolUse", tool_name: "Write",
        tool_input: { file_path: path, content: "forged" },
      }, dir);
      expect(result.block).toBe(true);
      expect(result.message).toMatch(pattern);
    }
  });

  // ── escape hatch ─────────────────────────────────────────────────────────
  it("AIDEV_GUARD=off disables every rule", () => {
    process.env.AIDEV_GUARD = "off";
    expect(decide(edit("src/thing.ts"), dir).block).toBe(false);
    expect(decide(edit(relative(dir, graphPath(dir)), "status: todo", "status: done"), dir).block).toBe(false);
    expect(decide({ hook_event_name: "Stop" }, dir).block).toBe(false);
  });
});
