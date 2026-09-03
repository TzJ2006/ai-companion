import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { normalizeClaude, decide } from "../../companion/guard.js";

// 图那条规则原来只比对「改前就有」的想法：`[...before.status]` 从改前的表出发，
// 改前没有、改后才出现的编号一次都没被看过。于是「改已有想法的 status」被挡住，
// 「整段追加一个 status: doing 的新想法」却是放行的 —— 而这个新节点会当场给
// agent 三重自授权：它的 verify.test_files 让产品文件在没有计划批准、没有 RED
// 的情况下可写，它的 code 想认哪个文件就认哪个文件，它的 verify.command 还会进
// 到 shell 的白名单里。signed_off 那行有同样的毛病（从 before.signed.keys()
// 出发），于是「插一个自带 verify.signed_off 的 done 节点」也是放行的。
// 补法：两处都改成比对 before ∪ after 的编号并集。新想法只能以 new 发的初始状态
// （todo）落地，别的状态一律回到 new + set；新出现的签字和被改过的签字一样拒绝。
// 同时必须保住日常：new 写出来的 todo 节点要能落地，只改叙述的编辑要照旧放行。
describe("companion guard graph rule on an INSERTED idea", () => {
  let dir: string;
  const dirs: string[] = [];

  const yaml = `version: 1
project: fixture
next_id: 2
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
    dir = mkdtempSync(join(tmpdir(), "insertednode-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  const edit = (old_string: string, new_string: string) => normalizeClaude({
    hook_event_name: "PreToolUse", tool_name: "Edit",
    tool_input: { file_path: join(dir, "ideas", "graph.yaml"), old_string, new_string }, cwd: dir,
  });

  /** 追加一整个节点：锚在文件末尾那行上，改后内容 = 原图 + 新节点。 */
  const append = (...node: string[]) => edit(`      pass: "exit 0"`, [`      pass: "exit 0"`, ...node].join("\n"));

  // ── 插进来的新节点不能自带状态 ───────────────────────────────────────────

  it("appending a node that arrives already `doing` is denied, and points at new + set", () => {
    const v = decide(append(
      `  - id: I-002`,
      `    name: "自己给自己开的活"`,
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
    ), dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/I-002/);
    expect(v.reason).toMatch(/new/);
    expect(v.reason).toMatch(/set/);
  });

  it("appending a node that arrives `done` with a forged signature is denied too", () => {
    const v = decide(append(
      `  - id: I-002`,
      `    name: "生下来就验收完了"`,
      `    status: done`,
      `    needs: []`,
      `    what: W`,
      `    why: Y`,
      `    expected: E`,
      `    how: H`,
      `    why_this_way: T`,
      `    future: F`,
      `    code:`,
      `      - file: src/a.ts`,
      `    verify:`,
      `      manual: "人工看一眼"`,
      `      signed_off: "张三 2026-09-02"`,
    ), dir);
    expect(v.allow).toBe(false);
  });

  it("a signature that appears together with a brand-new todo node is refused like an edited one", () => {
    const v = decide(append(
      `  - id: I-002`,
      `    name: "待办，但已经签好字了"`,
      `    status: todo`,
      `    needs: []`,
      `    what: W`,
      `    why: Y`,
      `    expected: E`,
      `    verify:`,
      `      manual: "人工看一眼"`,
      `      signed_off: "张三 2026-09-02"`,
    ), dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/manual-check/);
  });

  // ── 日常照旧 ─────────────────────────────────────────────────────────────

  it("the todo node `new` actually writes still lands", () => {
    const v = decide(append(
      `  - id: I-002`,
      `    name: "新想法"`,
      `    status: todo`,
      `    needs: [I-001]`,
      `    log:`,
      `      - date: "2026-09-02"`,
      `        by: new`,
      `        note: 创建`,
    ), dir);
    expect(v.allow).toBe(true);
  });

  it("a node appended with no status key at all is a todo node, and lands", () => {
    const v = decide(append(`  - id: I-002`, `    name: "还没想清楚"`, `    needs: []`), dir);
    expect(v.allow).toBe(true);
  });

  it("rewording an existing idea's why is still ordinary prose editing", () => {
    expect(decide(edit("why: Y", "why: 因为图必须一直是可以改的散文"), dir).allow).toBe(true);
  });

  it("flipping an existing idea's status is denied as before", () => {
    const v = decide(edit("status: doing", "status: done"), dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/set/);
  });
});
