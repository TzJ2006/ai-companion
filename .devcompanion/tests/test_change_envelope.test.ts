import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { createLedger, render, type Graph } from "../../claude-companion/ideas.js";

// I-077 — 改动记账本：字段改动和结构改动用同一种格式，草稿和磁盘文件也用同一种。
//
// 记账本是纯逻辑（不碰任何 DOM），所以和画图函数一样做成一份共用源码：
// 引擎求值它，页面嵌同一段文本。好处是这份测试能直接把六种操作跑一遍真的，
// 而不是只断言「页面里出现了 op 这个词」。
//
// 最要紧的一条是「把两条前置删成一条」。现在的账本比较新旧值用的是把两边都转成
// 字符串再比，而单元素数组转字符串恰好等于那个元素本身 —— 于是这个改动会被判成
// 「没有改动」然后从账上删掉。那条断言在下面。

const yaml = `version: 1
agent: claude
project: fixture
endpoints: [I-004]
ideas:
  - id: I-001
    name: "地基"
    status: done
    needs: []
    what: W1
  - id: I-002
    name: "中间层"
    status: todo
    needs: [I-001]
    what: W2
    how: H2
  - id: I-003
    name: "另一条"
    status: todo
    needs: [I-001]
  - id: I-004
    name: "终点：做完了"
    status: todo
    needs: [I-002, I-003]
`;

const DIGEST = "abc123def456";
const graphOf = () => parse(yaml) as Graph;
const ledgerOf = () => createLedger(graphOf(), DIGEST, "D:/p");

describe("I-077 改动记账本", () => {
  it("页面里嵌着这份记账本的源码", () => {
    const html = render(graphOf(), yaml, "D:/p");
    expect(html).toMatch(/<script id="ledger-fn">[\s\S]{200,}?<\/script>/);
  });

  it("什么都没做时账本是空的", () => {
    const l = ledgerOf();
    expect(l.isEmpty()).toBe(true);
    expect(l.ops()).toEqual([]);
  });

  // ── 六种操作 ───────────────────────────────────────────────────────────
  it("改一个字段，记下旧值和新值", () => {
    const l = ledgerOf();
    l.setField("I-002", "how", "新的写法");
    expect(l.ops()).toEqual([{ op: "set", id: "I-002", field: "how", old: "H2", new: "新的写法" }]);
  });

  it("改回原值，这条操作就消失", () => {
    const l = ledgerOf();
    l.setField("I-002", "how", "新的写法");
    l.setField("I-002", "how", "H2");
    expect(l.ops()).toEqual([]);
  });

  it("改状态，记下从什么变成什么", () => {
    const l = ledgerOf();
    l.setStatus("I-002", "doing");
    expect(l.ops()).toEqual([{ op: "status", id: "I-002", from: "todo", to: "doing" }]);
  });

  it("新建想法拿到一个临时号，真编号不由页面决定", () => {
    const l = ledgerOf();
    const tmp = l.addIdea({ name: "新想法", what: "W", why: "Y", expected: "E" });
    expect(tmp).toMatch(/^tmp:/);
    expect(l.ops()).toEqual([{ op: "add", tmp, fields: { name: "新想法", what: "W", why: "Y", expected: "E" } }]);
  });

  it("删除想法", () => {
    const l = ledgerOf();
    l.removeIdea("I-003");
    expect(l.ops()).toEqual([{ op: "remove", id: "I-003" }]);
  });

  it("连一条前置箭头，可以连到还没有真编号的新想法上", () => {
    const l = ledgerOf();
    const tmp = l.addIdea({ name: "新", what: "W", why: "Y", expected: "E" });
    l.link(tmp, "I-004");
    expect(l.ops()[1]).toEqual({ op: "link", from: tmp, to: "I-004" });
  });

  // 这一条是整个想法的由来。I-004 的前置是 [I-002, I-003]，断掉一条。
  it("把前置从两条删成一条，记的是「断了哪一条」，不是「没有改动」", () => {
    const l = ledgerOf();
    l.unlink("I-003", "I-004");
    expect(l.ops()).toEqual([{ op: "unlink", from: "I-003", to: "I-004" }]);
    expect(l.isEmpty()).toBe(false);
    expect(l.needsOf("I-004")).toEqual(["I-002"]);
  });

  it("连了又断，两条互相抵消", () => {
    const l = ledgerOf();
    l.link("I-001", "I-004");
    l.unlink("I-001", "I-004");
    expect(l.ops()).toEqual([]);
  });

  // 新建的想法还没落盘，删掉它等于从没建过 —— 不该给写回端留两条互相抵消的指令。
  it("删掉一个刚新建的临时想法，连它的新建操作一起消失", () => {
    const l = ledgerOf();
    const tmp = l.addIdea({ name: "新", what: "W", why: "Y", expected: "E" });
    l.link(tmp, "I-004");
    l.removeIdea(tmp);
    expect(l.ops()).toEqual([]);
  });

  // 一条都不能剩。剩下的那条会带着一个没人认领的临时号进改动文件，
  // 而「还剩临时号就整体拒绝落盘」是写回端的硬规矩 —— 也就是说一个被删掉的
  // 草稿想法会把同一次提交里所有别的编辑一起拖下水。UI 上两次点击就能做到：
  // 新建一张卡片、动一下它的状态下拉框、再点删除。
  it("删掉临时想法时，它身上的每一种操作都要清掉 —— 包括状态", () => {
    const l = ledgerOf();
    const tmp = l.addIdea({ name: "新", what: "W", why: "Y", expected: "E" });
    l.setField(tmp, "what", "写点什么");
    l.setStatus(tmp, "doing");
    l.link(tmp, "I-004");
    l.unlink("I-003", "I-004");        // 一条与它无关的改动，必须留着
    l.removeIdea(tmp);
    expect(l.ops()).toEqual([{ op: "unlink", from: "I-003", to: "I-004" }]);
    expect(JSON.stringify(l.ops()), "改动文件里还留着临时号").not.toContain("tmp:");
  });

  // ── 信封 ───────────────────────────────────────────────────────────────
  it("信封带版本号、项目和图指纹，指纹是原样带回的", () => {
    const l = ledgerOf();
    l.setField("I-002", "how", "x");
    const env = l.envelope();
    expect(env.v).toBe(1);
    expect(env.project).toBe("D:/p");
    expect(env.baseDigest).toBe(DIGEST);       // 页面绝不自己算
    expect(env.ops).toEqual(l.ops());
  });

  it("信封存进去再读回来，一条不少、顺序不变", () => {
    const l = ledgerOf();
    l.setField("I-002", "how", "新的写法");
    l.setStatus("I-002", "doing");
    const tmp = l.addIdea({ name: "新", what: "W", why: "Y", expected: "E" });
    l.link(tmp, "I-004");
    l.unlink("I-003", "I-004");
    l.removeIdea("I-001");
    const wire = JSON.stringify(l.envelope());

    const back = ledgerOf();
    back.load(JSON.parse(wire));
    expect(back.ops()).toEqual(l.ops());
    expect(back.ops()).toHaveLength(6);         // 六种操作各一条
  });

  // 草稿写进去时存了指纹，现在读回来时从不比较它 —— 一份对着旧图写的草稿
  // 会被无声地拿出来恢复。等「删掉某个想法」存在之后，这就不再是无害的了。
  it("读回一份对着别的图写的草稿，会说它过期了", () => {
    const l = ledgerOf();
    l.setField("I-002", "how", "x");
    const stale = { ...l.envelope(), baseDigest: "000000000000" };
    expect(ledgerOf().load(stale).stale).toBe(true);
    expect(ledgerOf().load(l.envelope()).stale).toBe(false);
  });

  it("读回一份版本号不认识的信封，整体拒绝", () => {
    const l = ledgerOf();
    expect(() => l.load({ v: 99, project: "D:/p", baseDigest: DIGEST, ops: [] })).toThrow();
  });

  // ── 页面确实接在这本账上 ────────────────────────────────────────────────
  // 这两条是实现之后补的（上面 15 条是先红后绿）。留着，是因为「页面重开能逐条
  // 恢复」是 expected 的一部分，没有断言盯着它就会在下一次改动里悄悄退化。
  it("页面的编辑脚本用的是这本账，不是原来那张表", () => {
    const script = render(graphOf(), yaml, "D:/p");
    expect(script).toContain("createLedger(DATA, FINGERPRINT, PROJECT)");
    expect(script).not.toContain("const changes = new Map()");   // 旧账本没有残留
  });

  it("草稿存的就是信封本身，而且读回来会比对指纹", () => {
    const script = render(graphOf(), yaml, "D:/p");
    expect(script).toContain("JSON.stringify(ledger.envelope())");
    expect(script).toContain("env.baseDigest !== FINGERPRINT");   // 原来存了却从不比对
  });
});
