import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { normalizeClaude, decide } from "../../companion/guard.js";
import { load, graphPath, allowWrite } from "../../companion/ideas.js";

// 第二轮把图规则改成比对 before ∪ after 的编号并集，堵住了「追加一个有编号的
// doing 节点」。但那两张表仍然是 `Map<id, …>`，于是同一个洞还剩两条路：
//   (a) 没有 id 的节点被 `if (!idea.id) continue` 整个跳过，前后两张表都看不见
//       它 —— 而引擎读图是按数组逐个扫 status 的，这个无编号的 doing 节点是活的，
//       当场就能给产品文件授权；
//   (b) 表按 id 建，编号重复时后写覆盖先写。把一个 doing 的副本插在真节点「前面」，
//       改后表里读到的是后面那个 todo，flip 检测不出来，而引擎的数组扫描两个都看见。
// 补法：守卫要按引擎读图的方式判图 —— 按位置(而不是一张会碰撞的表)比对；无编号
// 节点一律当新节点，只能以初始状态落地；编号重复本身就是毛病，要报给人，不能用
// 「后写覆盖」悄悄和稀泥。守卫跑在引擎 check 之前，不能比引擎读得还弱。
describe("companion guard graph rule reads the graph the way the engine does", () => {
  let dir: string;
  const dirs: string[] = [];

  const yaml = `version: 1
project: fixture
next_id: 3
endpoints: [I-001]
ideas:
  - id: I-001
    name: "进行中的想法"
    status: doing
    needs: []
    what: W1
    why: 因为要有一个已经在做的想法
    expected: E1
    how: H1
    why_this_way: T1
    future: F1
    code:
      - file: src/a.ts
    verify:
      command: "node checker.cjs"
      test_files: [ tests/a.test.txt ]
      pass: "exit 0"
  - id: I-002
    name: "还没开始的想法"
    status: todo
    needs: []
    what: W2
    why: 因为要有一个待办的想法可以被复制
    expected: E2
    how: H2
    why_this_way: T2
    future: F2
    code:
      - file: src/b.ts
    verify:
      command: "node checker.cjs"
      test_files: [ tests/b.test.txt ]
      pass: "exit 0"
`;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "dupid-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  const edit = (old_string: string, new_string: string) => normalizeClaude({
    hook_event_name: "PreToolUse", tool_name: "Edit",
    tool_input: { file_path: join(dir, "ideas", "graph.yaml"), old_string, new_string }, cwd: dir,
  });

  /** 追加一整个节点：锚在文件最后一行上，改后内容 = 原图 + 新节点。 */
  const append = (...node: string[]) => edit(
    `      test_files: [ tests/b.test.txt ]\n      pass: "exit 0"`,
    [`      test_files: [ tests/b.test.txt ]`, `      pass: "exit 0"`, ...node].join("\n"));

  /** 改后的图落到盘上 —— 用来问引擎：这个节点在你眼里是不是活的。 */
  const applyToDisk = (event: ReturnType<typeof normalizeClaude>) => {
    const file = join(dir, "ideas", "graph.yaml");
    const current = readFileSync(file, "utf8");
    writeFileSync(file, current.replace(event.edit!.old_string!, event.edit!.new_string!));
  };

  // ── (a) 没有编号的节点 ───────────────────────────────────────────────────

  const idlessDoing = [
    `  - name: "连编号都没写的活"`,
    `    status: doing`,
    `    needs: []`,
    `    what: W`,
    `    why: Y`,
    `    expected: E`,
    `    how: H`,
    `    why_this_way: T`,
    `    future: F`,
    `    code:`,
    `      - file: src/anything.ts`,
    `    verify:`,
    `      command: "node evil.cjs"`,
    `      test_files: [ tests/anything.test.ts ]`,
    `      pass: "exit 0"`,
  ];

  it("an appended node with NO id but `status: doing` is denied", () => {
    const v = decide(append(...idlessDoing), dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/set|new/);
  });

  it("the id-less doing node is not theatre: the engine's own scan hands it the file", () => {
    applyToDisk(append(...idlessDoing));
    const { graph } = load(graphPath(dir));
    expect(allowWrite(graph, dir, "src/anything.ts").allow).toBe(true);
  });

  // ── (b) 编号重复：doing 的副本插在真节点前面 ─────────────────────────────

  const duplicateDoingFirst = () => edit(`  - id: I-002\n    name: "还没开始的想法"`, [
    `  - id: I-002`,
    `    name: "抢在前面的同号副本"`,
    `    status: doing`,
    `    needs: []`,
    `    what: W`,
    `    why: Y`,
    `    expected: E`,
    `    how: H`,
    `    why_this_way: T`,
    `    future: F`,
    `    code:`,
    `      - file: src/anything.ts`,
    `    verify:`,
    `      command: "node evil.cjs"`,
    `      test_files: [ tests/anything.test.ts ]`,
    `      pass: "exit 0"`,
    `  - id: I-002`,
    `    name: "还没开始的想法"`,
  ].join("\n"));

  it("a duplicate `doing` copy placed BEFORE the real todo node is denied", () => {
    const v = decide(duplicateDoingFirst(), dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/I-002/);
  });

  it("the duplicate is not theatre either: the engine sees both nodes, doing one included", () => {
    applyToDisk(duplicateDoingFirst());
    const { graph } = load(graphPath(dir));
    expect(allowWrite(graph, dir, "src/anything.ts").allow).toBe(true);
  });

  // ── 日常照旧 ─────────────────────────────────────────────────────────────

  it("an ordinary appended todo node with a proper id still lands", () => {
    const v = decide(append(
      `  - id: I-003`,
      `    name: "新想法"`,
      `    status: todo`,
      `    needs: [I-001]`,
      `    what: W`,
      `    why: Y`,
      `    expected: E`,
      `    log:`,
      `      - date: "2026-09-02"`,
      `        by: new`,
      `        note: 创建`,
    ), dir);
    expect(v.allow).toBe(true);
  });

  it("an id-less node that is merely a todo is left to check/R5, not blocked here", () => {
    const v = decide(append(`  - name: "还没编号的草稿"`, `    needs: []`), dir);
    expect(v.allow).toBe(true);
  });

  it("rewording an existing idea's why is still ordinary prose editing", () => {
    const v = decide(edit("why: 因为要有一个待办的想法可以被复制", "why: 因为图必须一直是可以改的散文"), dir);
    expect(v.allow).toBe(true);
  });

  it("deleting the duplicate is the way OUT — a graph with one I-002 left is writable again", () => {
    // 先把重复写到盘上（模拟已经坏掉的图），再看「删掉多出来那份」的编辑还走不走得通。
    applyToDisk(duplicateDoingFirst());
    const current = readFileSync(join(dir, "ideas", "graph.yaml"), "utf8");
    const dup = current.slice(current.indexOf(`  - id: I-002\n    name: "抢在前面的同号副本"`),
      current.indexOf(`  - id: I-002\n    name: "还没开始的想法"`));
    const v = decide(edit(dup, ""), dir);
    expect(v.allow).toBe(true);
  });

  it("flipping an existing idea's status by hand is denied as before", () => {
    const v = decide(edit("status: todo", "status: done"), dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/set/);
  });
});
