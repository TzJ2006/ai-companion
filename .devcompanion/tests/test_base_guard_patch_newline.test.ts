import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { normalizeCodex, normalizeCursor, decide } from "../../companion/guard.js";

// 补丁重建这条路（D23）本身是对的，但它把「补丁原文最后那个换行」当成了一行。
//
// 真实的补丁没有一个是不以换行结尾的：Codex 的 apply_patch、Cursor 的 unified
// diff、git diff，末行后面都有 `\n`。`split(/\r?\n/)` 把这个结束符切成一个末尾
// 空串，hunk 解析器读到它时既不是 `+` 也不是 `-`，于是当成上下文行，给最后一个
// hunk 的「改前像」凭空追加了一个空行。除非被改的那行后面正好是空行，否则这个
// hunk 永远贴不回文件 —— 结论是：对想法图的每一次补丁形状的编辑都被拒，而拒绝
// 话术让人「重新读一遍再出补丁」，再出一次还是同一份补丁，死循环。
//
// 这个洞躲过了整套测试，只因为仓库里所有补丁夹具都是 join("\n") 拼的、末尾恰好
// 没有换行 —— 也就是说，夹具写的是现实中不存在的补丁。
//
// 下面所有夹具都以换行收尾，跟真补丁一样。
describe("companion guard patch path: a newline-terminated patch is a real patch (D23/R2)", () => {
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

  /** 跨行流式映射偷渡一个 doing 想法 —— 第四轮堵上的那个洞。 */
  const SMUGGLED = [
    "+  - {id: I-002, name: 偷偷塞进来的想法,",
    "+     needs: [], what: W, why: Y, expected: E,",
    "+     how: H, why_this_way: T, future: F, status: doing,",
    "+     code: [{file: src/b.ts}],",
    '+     verify: {command: "node checker.cjs", test_files: [tests/b.test.txt], pass: "exit 0"}}',
  ];
  const ANCHOR = '       pass: "exit 0"';

  /** 真补丁：末尾带换行。eol 可切成 \r\n，用来验证回车不会另外炸一次。 */
  const codexPatch = (lines: string[], eol = "\n") => normalizeCodex({
    hook_event_name: "PreToolUse", tool_name: "apply_patch",
    tool_input: {
      command: ["*** Begin Patch", "*** Update File: ideas/graph.yaml", ...lines, "*** End Patch"].join(eol) + eol,
    },
    cwd: dir,
  });

  const cursorPatch = (lines: string[], eol = "\n") => normalizeCursor({
    hook_event_name: "preToolUse", tool_name: "ApplyPatch",
    tool_input: {
      path: "ideas/graph.yaml",
      patch: ["--- a/ideas/graph.yaml", "+++ b/ideas/graph.yaml", ...lines].join(eol) + eol,
    },
    cwd: dir,
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "patchnewline-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  // ── 洞本身：以换行收尾的普通改叙述补丁，被无理由拒掉 ─────────────────────

  it("codex: a prose-only graph patch that ends with a newline goes through", () => {
    const v = decide(codexPatch(["@@", "-    how: H", "+    how: 换一种写法"]), dir);
    expect(v.reason ?? "").not.toMatch(/贴不回现在的文件/);
    expect(v.allow).toBe(true);
  });

  it("cursor: the same, as a newline-terminated unified diff", () => {
    const v = decide(cursorPatch(["@@ -9,1 +9,1 @@", "-    why: Y", "+    why: 换个理由"]), dir);
    expect(v.reason ?? "").not.toMatch(/贴不回现在的文件/);
    expect(v.allow).toBe(true);
  });

  it("a newline-terminated patch that changes the graph's LAST line goes through", () => {
    // 改最后一行时，凭空追加的空行原本可能歪打正着地对上文件末尾的空串 ——
    // 这里连 `*** End Patch` 一起被读成上下文，所以还是贴不回去。
    const v = decide(codexPatch(["@@", `-${ANCHOR.slice(1)}`, '+      pass: "exit 0 就算过"']), dir);
    expect(v.allow).toBe(true);
  });

  it("a patch whose own last hunk line is a real blank context line still fits", () => {
    // 结束符被丢掉，补丁自己带的那个空行（"\\n\\n" 里的前一个）必须留着 ——
    // 它对应文件末尾换行切出来的那个空串。
    const v = decide(codexPatch(["@@", `-${ANCHOR.slice(1)}`, '+      pass: "exit 0 就算过"', ""]), dir);
    expect(v.allow).toBe(true);
  });

  it("CRLF: a patch delivered with \\r\\n line endings goes through", () => {
    expect(decide(codexPatch(["@@", "-    how: H", "+    how: 换一种写法"], "\r\n"), dir).allow).toBe(true);
    expect(decide(cursorPatch(["@@ -9,1 +9,1 @@", "-    why: Y", "+    why: 换个理由"], "\r\n"), dir).allow).toBe(true);
  });

  it("CRLF: a CRLF graph edited by a CRLF patch goes through", () => {
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml.replaceAll("\n", "\r\n"));
    const v = decide(codexPatch(["@@", "-    how: H", "+    how: 换一种写法"], "\r\n"), dir);
    expect(v.allow).toBe(true);
  });

  it("a graph with no final newline, patched with the `\\ No newline` marker, goes through", () => {
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml.trimEnd());
    const v = decide(codexPatch(["@@",
      `-${ANCHOR.slice(1)}`,
      "\\ No newline at end of file",
      '+      pass: "exit 0 就算过"',
      "\\ No newline at end of file",
    ]), dir);
    expect(v.allow).toBe(true);
  });

  // ── 第四轮那条安全性质必须原样保住 ───────────────────────────────────────

  it("codex: the split flow-mapping injection is still denied when the patch ends with a newline", () => {
    const v = decide(codexPatch(["@@", ANCHOR, ...SMUGGLED]), dir);
    expect(v.allow).toBe(false);
    // 这句话只有「重建出后像、逐个比节点」那条路说得出来 —— 断言它，就是断言
    // 判决真是重建做出来的，而不是又退回到「贴不回去」的兜底拒绝。
    expect(v.reason).toMatch(/新加的想法只能以 todo 落地/);
    expect(v.reason).toContain("I-002");
  });

  it("cursor: the same injection, newline-terminated, is still denied by the rebuilt post-image", () => {
    const v = decide(cursorPatch(["@@ -19,1 +19,6 @@", ANCHOR, ...SMUGGLED]), dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/新加的想法只能以 todo 落地/);
  });

  it("a newline-terminated status flip is still denied by name", () => {
    const v = decide(codexPatch(["@@", "-    status: doing", "+    status: done"]), dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/ideas[\\/]graph\.yaml/);
  });

  it("a hunk whose context is nowhere in the graph is still denied, newline or not", () => {
    const v = decide(codexPatch(["@@", "     这一行图里根本没有", "+    future: 换个说法"]), dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/贴不回现在的文件/);
  });
});
