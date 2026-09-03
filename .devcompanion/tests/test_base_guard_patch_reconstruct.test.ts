import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { load, graphPath } from "../../companion/ideas.js";
import { normalizeCodex, normalizeCursor, decide } from "../../companion/guard.js";

// 两条投递路线原来是按两种严格程度判图的，弱的那条还是三家里两家的默认写法。
// 带得出改后内容的普通编辑，规则是把整份节点列表重建出来逐个对比 —— 插节点、
// 不写 id、重号三个洞就是这么堵上的；补丁形状（Codex 的 apply_patch、Cursor 的
// ApplyPatch）却退化成在 hunk 里逐行找 status / signed_off 这个词。
//
// 被演示出来的绕法：把新节点写成一个跨行的 YAML 流式映射，让 status 落在某一行
// 的中间 —— 行首匹配看不见它（那一行开头是 how:），同行流式匹配也看不见它
// （`{` 在上一行）。于是一个全新的、可以直接开工的 doing 想法就这么进了图，
// 引擎再读回来时它是真的算数的。
//
// 补法：补丁也重建后像，把图那一段的 hunk 应用到当前文件上，然后跑普通编辑那条
// 路完全相同的节点列表对比 —— 一条规则，两种投递。hunk 贴不回去就拒绝：重建不
// 出来的图写正是 D23 说的「看不出来 ≠ 无害」。
describe("companion guard patch path reconstructs the post-image (D23/R2/D19/D28)", () => {
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

  /** 偷渡的那五行：status 落在第三行中间，`{` 在第一行。 */
  const SMUGGLED = [
    "+  - {id: I-002, name: 偷偷塞进来的想法,",
    "+     needs: [], what: W, why: Y, expected: E,",
    "+     how: H, why_this_way: T, future: F, status: doing,",
    "+     code: [{file: src/b.ts}],",
    '+     verify: {command: "node checker.cjs", test_files: [tests/b.test.txt], pass: "exit 0"}}',
  ];
  /** 图最后一行，当 hunk 的上下文用。 */
  const ANCHOR = '       pass: "exit 0"';

  const codexPatch = (...lines: string[]) => normalizeCodex({
    hook_event_name: "PreToolUse", tool_name: "apply_patch",
    tool_input: { command: ["*** Begin Patch", "*** Update File: ideas/graph.yaml", ...lines, "*** End Patch"].join("\n") },
    cwd: dir,
  });

  const codexMulti = (...lines: string[]) => normalizeCodex({
    hook_event_name: "PreToolUse", tool_name: "apply_patch",
    tool_input: { command: ["*** Begin Patch", ...lines, "*** End Patch"].join("\n") },
    cwd: dir,
  });

  const cursorPatch = (...lines: string[]) => normalizeCursor({
    hook_event_name: "preToolUse", tool_name: "ApplyPatch",
    tool_input: { path: "ideas/graph.yaml", patch: ["--- a/ideas/graph.yaml", "+++ b/ideas/graph.yaml", ...lines].join("\n") },
    cwd: dir,
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "patchrebuild-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  // ── 先证明这个后像真的算数，再谈守卫该不该拦 ─────────────────────────────

  it("the smuggled flow mapping is not a trick of the eye — the engine reads it back as a live doing idea", () => {
    const injected = readFileSync(join(dir, "ideas", "graph.yaml"), "utf8")
      + SMUGGLED.map((line) => line.slice(1)).join("\n") + "\n";
    writeFileSync(join(dir, "ideas", "graph.yaml"), injected);
    const { graph } = load(graphPath(dir));
    const smuggled = graph.ideas.find((idea) => idea.id === "I-002");
    expect(smuggled?.status).toBe("doing");
    expect(smuggled?.code?.[0]?.file).toBe("src/b.ts");
  });

  // ── 洞本身：跨行流式映射塞进来的 doing 想法 ──────────────────────────────

  // 拒绝话术特意校到「新加的想法只能以 todo 落地」这一句：那是重建出后像、跑
  // 节点列表对比才说得出的话。逐行扫描那条路只会说「补丁里直接增删了…的 status」，
  // 所以这几个断言同时证明了是重建那条路做的判决。
  it("codex: a doing idea smuggled in as a flow mapping split across patch lines is denied", () => {
    const v = decide(codexPatch("@@", ANCHOR, ...SMUGGLED), dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/新加的想法只能以 todo 落地/);
    expect(v.reason).toContain("I-002");
  });

  it("cursor: the same split flow mapping in a unified diff is denied", () => {
    const v = decide(cursorPatch("@@ -19,1 +19,6 @@", ANCHOR, ...SMUGGLED), dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/新加的想法只能以 todo 落地/);
    expect(v.reason).toContain("I-002");
  });

  it("the id-less variant of the same trick is denied too — it was the whole point of walking the list", () => {
    const v = decide(codexPatch("@@", ANCHOR,
      "+  - {name: 没有编号的想法,",
      "+     needs: [], what: W, why: Y, expected: E,",
      "+     how: H, why_this_way: T, future: F, status: doing,",
      '+     code: [{file: src/b.ts}]}',
    ), dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/新加的想法只能以 todo 落地/);
  });

  // 一条规则两种投递（D22）的另一半：合法的动作两边也必须一样过。逐行扫描那条
  // 路做不到这一点 —— `new` 落一个新想法，补丁里就是一行 `+ status: todo`，
  // 跟偷渡一个 doing 长得一模一样，扫描区分不了，只能一律拒。于是两家补丁宿主
  // 比 Claude 严，严在规范说合法的那一步上。重建后像才分得清：判的是重建出来的
  // 那份图里这个新节点是以什么状态落地的。
  it("a lawful brand-new todo node goes through on both patch hosts, exactly as it does on the Edit path", () => {
    const born = [
      "+  - {id: I-002, name: 规规矩矩新开的想法,",
      "+     needs: [], what: W, why: Y, expected: E,",
      "+     how: H, why_this_way: T, future: F, status: todo,",
      '+     code: [{file: src/b.ts}]}',
    ];
    expect(decide(codexPatch("@@", ANCHOR, ...born), dir).allow).toBe(true);
    expect(decide(cursorPatch("@@ -19,1 +19,5 @@", ANCHOR, ...born), dir).allow).toBe(true);
  });

  it("a signature smuggled the same way is denied (D27)", () => {
    const v = decide(codexPatch("@@",
      '       command: "node checker.cjs"',
      "-      test_files: [ tests/a.test.txt ]",
      "+      test_files: [ tests/a.test.txt ]",
      "+      manual: {who: 张三,",
      "+        signed_off: 张三看过了}",
    ), dir);
    expect(v.allow).toBe(false);
  });

  // ── hunk 贴不回去就拒绝（D23） ───────────────────────────────────────────

  it("a hunk whose context is nowhere in the graph cannot be reconstructed, so it is denied", () => {
    const v = decide(codexPatch("@@", "     这一行图里根本没有", "+    future: 换个说法"), dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/ideas[\\/]graph\.yaml/);
  });

  // ── 不许因此过度拦截：普通活儿照旧 ───────────────────────────────────────

  it("an ordinary prose-only graph patch still goes through, on both dialects", () => {
    expect(decide(codexPatch("@@", "-    how: H", "+    how: 换一种写法"), dir).allow).toBe(true);
    expect(decide(cursorPatch("@@ -9,1 +9,1 @@", "-    why: Y", "+    why: 换个理由"), dir).allow).toBe(true);
  });

  it("a prose patch carrying real context lines around the change still goes through", () => {
    expect(decide(codexPatch("@@",
      "     expected: E",
      "-    how: H",
      "+    how: 换一种写法",
      "     why_this_way: T",
    ), dir).allow).toBe(true);
  });

  it("a multi-file patch whose graph hunk is prose still goes through", () => {
    const v = decide(codexMulti(
      "*** Update File: ideas/graph.yaml",
      "@@",
      "-    why: Y",
      "+    why: 换个理由",
      "*** Update File: ideas/log.md",            // 账本，本来就可写
      "@@",
      "+  - id: I-002",
      "+    status: doing",
    ), dir);
    expect(v.allow).toBe(true);
  });

  it("a graph patch that does not touch the ideas list at all still goes through", () => {
    expect(decide(codexPatch("@@", "-project: fixture", "+project: 换个项目名"), dir).allow).toBe(true);
  });

  // ── 逐行扫描留着当第二道保险：拒绝话术仍然点名图文件、引用图自己那一行 ────

  it("a status flip in a patch is still denied with the message that names the graph file", () => {
    const v = decide(codexMulti(
      "*** Update File: ideas/log.md",
      "@@",
      "+    status: blocked",                    // 别的文件里的一行，不该被引用
      "*** Update File: ideas/graph.yaml",
      "@@",
      "+    status: done",
    ), dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/ideas[\\/]graph\.yaml/);
    expect(v.reason).toContain("status: done");
    expect(v.reason).not.toContain("blocked");
  });
});
