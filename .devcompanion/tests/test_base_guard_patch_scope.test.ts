import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseDocument } from "yaml";
import { normalizeCodex, normalizeCursor, decide } from "../../companion/guard.js";
import { load, graphPath, requestApproval, applyApproval } from "../../companion/ideas.js";

// R4 — 补丁那半边的图规则有三个洞，都是「只看得见一种写法」的同一个毛病：
//   (a) 字段名只认行首光秃秃的一个词，于是 `"status": done`、`'status': done`、
//       以及流式映射 `{id: I-002, status: doing}` 全都溜过去了 —— 而 yaml 解析器
//       把它们统统读回成真的 status，D24/D27 点名保护的两个字段等于没守住；
//   (b) 扫的是整份补丁文本，不是图那一段。多文件补丁里只要别的文件带一行
//       status（本仓库的 vitest fixture 里到处都是 YAML），只改叙述的图段也被拒，
//       而且拒绝话术引的是别的文件那一行、却说图的状态被翻了 —— 人被指去错地方；
//   (c) 三星标题只认顶格的，缩进一格的标题既不算操作也不算「不认识」，旁边挂一条
//       合法标题就整单放行。Codex 自己的解析器是不是这么宽松无从证实，那就按不
//       认识处理，失败朝拒绝那边倒（D23）。
describe("companion guard patch-shaped graph rule: spelling, scope, headers (R4)", () => {
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

  /** 单文件：整份补丁只动图。 */
  const codexPatch = (...lines: string[]) => normalizeCodex({
    hook_event_name: "PreToolUse", tool_name: "apply_patch",
    tool_input: { command: ["*** Begin Patch", "*** Update File: ideas/graph.yaml", ...lines, "*** End Patch"].join("\n") },
    cwd: dir,
  });

  /** 多文件：标题自己写在 lines 里。 */
  const codexMulti = (...lines: string[]) => normalizeCodex({
    hook_event_name: "PreToolUse", tool_name: "apply_patch",
    tool_input: { command: ["*** Begin Patch", ...lines, "*** End Patch"].join("\n") },
    cwd: dir,
  });

  const cursorPatch = (...lines: string[]) => normalizeCursor({
    hook_event_name: "preToolUse", tool_name: "ApplyPatch",
    tool_input: { path: "ideas/graph.yaml", patch: lines.join("\n") }, cwd: dir,
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "patchscope-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  /** I-001 的测试文件要写得下去，得先有当前有效的计划批准（D7/D17）——
   *  这一套测的是补丁怎么分段、拒绝话术指哪儿，所以先把那道闸买下来，
   *  免得话术被一句「还没批准」顶掉，看不出分段对不对。 */
  const approvePlan = () => {
    const { challenge } = requestApproval(dir, load(graphPath(dir)).graph, "plan", ["I-001"]);
    applyApproval(dir, `批准 ${challenge}`, { date: "2026-09-02" });
  };

  // ── (a) 字段名的三种写法，解析器都当真 ───────────────────────────────────

  it("the quoted and flow spellings really are the field — the yaml parser reads them back", () => {
    for (const text of ['"status": done', "'status': done", "{id: I-002, status: doing}"]) {
      expect((parseDocument(text).toJSON() as Record<string, unknown>)["status"], text).toBeDefined();
    }
    for (const text of ['"signed_off": 张三', "'signed_off': 张三", "{signed_off: 张三}"]) {
      expect((parseDocument(text).toJSON() as Record<string, unknown>)["signed_off"], text).toBeDefined();
    }
  });

  it("a status written quoted or inside a flow mapping is denied, not only the bare token", () => {
    for (const line of ['+    "status": done', "+    'status': done", "+  - {id: I-002, status: doing}"]) {
      const v = decide(codexPatch("@@", line), dir);
      expect(v.allow, line).toBe(false);
      expect(v.reason, line).toMatch(/set/);
    }
  });

  it("the same three spellings of signed_off are denied too", () => {
    for (const line of ['+      "signed_off": 张三看过了', "+      'signed_off': 张三看过了", "+    verify: {signed_off: 张三看过了}"]) {
      const v = decide(codexPatch("@@", line), dir);
      expect(v.allow, line).toBe(false);
      expect(v.reason, line).toMatch(/manual-check/);
    }
  });

  it("a removed line counts the same as an added one, whatever the spelling", () => {
    expect(decide(codexPatch("@@", '-    "status": doing'), dir).allow).toBe(false);
  });

  it("prose that merely mentions the field name is still prose (R2)", () => {
    expect(decide(codexPatch("@@", "-    how: H", "+    how: 改 status: 一律走 set，不手改"), dir).allow).toBe(true);
    expect(decide(codexPatch("@@", "-    why: Y", "+    why: signed_off 只能人来签"), dir).allow).toBe(true);
  });

  // ── (b) 只扫图那一段，拒绝话术也指向图 ───────────────────────────────────

  it("a multi-file patch whose graph hunk is pure prose goes through, even next to a fixture full of YAML", () => {
    approvePlan();
    const event = codexMulti(
      "*** Update File: ideas/graph.yaml",
      "@@",
      "-    how: H",
      "+    how: 换一种写法",
      "*** Update File: tests/a.test.txt",     // I-001 声明的测试文件，本来就可写
      "@@",
      "+  - id: I-002",
      "+    status: doing",                    // fixture 里的 YAML，不是图
      "+    signed_off: 张三",
    );
    const v = decide(event, dir);
    expect(v.allow).toBe(true);
  });

  it("cursor's unified diff splits the same way — only the graph's own hunk is read", () => {
    const v = decide(cursorPatch(
      "--- a/ideas/graph.yaml",
      "+++ b/ideas/graph.yaml",
      "@@ -9,1 +9,1 @@",
      "-    why: Y",
      "+    why: 换个理由",
      "--- a/tests/a.test.txt",
      "+++ b/tests/a.test.txt",
      "@@ -1,0 +1,2 @@",
      "+  - id: I-002",
      "+    status: doing",
    ), dir);
    expect(v.allow).toBe(true);
  });

  it("when the graph hunk really does flip a status, the deny names the graph and quotes the graph's line", () => {
    approvePlan();
    const v = decide(codexMulti(
      "*** Update File: tests/a.test.txt",
      "@@",
      "+    status: blocked",                  // 别的文件里的一行，不该被引用
      "*** Update File: ideas/graph.yaml",
      "@@",
      "+    status: done",
    ), dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/ideas[\\/]graph\.yaml/);
    expect(v.reason).toContain("status: done");
    expect(v.reason).not.toContain("blocked");
  });

  it("the other dialect's header cannot be forged out of hunk content to shake the section off", () => {
    // Codex 补丁里删掉一行 `-- decoy.txt`，上线就是 `--- decoy.txt`：当成 unified
    // diff 的文件标题读，图自己那段剩下的行就被记到别人头上了。
    const v = decide(codexPatch("@@", "--- decoy.txt", "+    status: done"), dir);
    expect(v.allow).toBe(false);
    // 反过来，unified diff 里加一行三星标题也不该改变归属。
    const w = decide(cursorPatch(
      "--- a/ideas/graph.yaml",
      "+++ b/ideas/graph.yaml",
      "@@ -1,0 +1,2 @@",
      "+*** Update File: decoy.txt",
      "+    status: done",
    ), dir);
    expect(w.allow).toBe(false);
  });

  it("a rename declared on the graph section keeps that section under the rule", () => {
    const v = decide(codexMulti(
      "*** Update File: ideas/graph.yaml",
      "*** Move to: ideas/graph.yaml",
      "@@",
      "+    status: done",
    ), dir);
    expect(v.allow).toBe(false);
  });

  // ── (c) 缩进的三星标题：不认识就整单拒 ───────────────────────────────────

  it("an indented three-star header is not an operation and not silently ignored", () => {
    const event = codexMulti(
      "*** Update File: ideas/log.md",
      "+note",
      "  *** Add File: src/evil.ts",           // 缩进一格就绕过了标题对账
      "+evil",
    );
    expect(event.unknownTarget).toBe(true);
    expect(decide(event, dir).allow).toBe(false);
  });

  // ── 普通的正确活儿照旧 ───────────────────────────────────────────────────

  it("the ordinary patches still go through", () => {
    approvePlan();
    expect(decide(codexMulti("*** Update File: ideas/log.md", "+- 2026-09-02  写了点东西"), dir).allow).toBe(true);
    expect(decide(codexMulti("*** Update File: tests/a.test.txt", "@@", "+  status: doing"), dir).allow).toBe(true);
    expect(decide(codexPatch("@@", "-    expected: E", "+    expected: 换个说法"), dir).allow).toBe(true);
  });
});
