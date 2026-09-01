import { describe, it, expect } from "vitest";
import { Window } from "happy-dom";
import { parse } from "yaml";
import { render, type Graph } from "../../claude-companion/ideas.js";

// I-063 — 在网页上增删想法和前置关系。
//
// 这份测试真的把页面装进一个 DOM 里、真的去点，然后看账本和页面变成什么样 ——
// 断言「页面里出现了某个字符串」的测试在功能坏掉时不会红，等于没有。
//
// 画图那个模块要从 CDN 取东西，测试里不执行它。这正好把两种情况都覆盖了：
// 不塞重画函数就是断网，塞一个假的就是联网。

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
    code:
      - file: src/base.ts
        symbol: baseFn
        lines: "1-20"
    verify: { command: "npx vitest run base.test.ts", pass: "exit 0" }
  - id: I-002
    name: "中间层"
    status: todo
    needs: [I-001]
    what: W2
  - id: I-003
    name: "另一条"
    status: todo
    needs: [I-001]
  - id: I-004
    name: "终点：做完了"
    status: todo
    needs: [I-002, I-003]
`;

const PROJECT = "D:/p";
const graphOf = () => parse(yaml) as Graph;

/** The editing module — the one that wires the page to the ledger. */
function editingModule(html: string): string {
  const blocks = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const found = blocks.find((b) => b.includes("createLedger"));
  expect(found, "页面里没有接账本的编辑模块").toBeTruthy();
  return found!;
}

/**
 * Load the page and run only the scripts a browser would run without network:
 * the two shared-source blocks and the editing module.
 * `redraw` false leaves `window.redrawGraph` undefined — that is the offline case.
 */
function openPage({ redraw = true } = {}) {
  const html = render(graphOf(), yaml, PROJECT);
  const window = new Window({ url: "file:///D:/p/ideas/graph.html" });
  const document = window.document;
  // innerHTML never executes scripts, so nothing runs until we say so.
  document.write("<!doctype html><html><body></body></html>");
  document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>"));

  const drawn: string[] = [];
  if (redraw) (window as any).redrawGraph = (src: string) => { drawn.push(src); };

  for (const id of ["mermaid-source-fn", "ledger-fn"]) {
    const el = document.getElementById(id);
    expect(el, `页面里没有 ${id}`).toBeTruthy();
    (window as any).eval(el!.textContent);
  }
  (window as any).eval(editingModule(html));
  return { window, document, drawn, html };
}

/** What the book holds right now, read back the way the page stores it. */
function ops(window: any): any[] {
  const key = window.document.getElementById("graph-data").dataset.draftKey;
  const raw = window.localStorage.getItem(key);
  return raw ? JSON.parse(raw).ops : [];
}

const card = (document: any, id: string) => document.getElementById(id);

describe("I-063 网页上增删想法和前置关系", () => {
  // ── 脚本顺序 ───────────────────────────────────────────────────────────
  // 编辑必须排在画图前面：画图第一件事是从 CDN 取模块并且用了顶层等待，
  // 排在它后面就等于让编辑功能排在一次跨网请求之后才能用。
  it("编辑脚本排在画图脚本前面", () => {
    const html = render(graphOf(), yaml, PROJECT);
    expect(html.indexOf("createLedger(DATA")).toBeLessThan(html.indexOf("cdn.jsdelivr.net"));
  });

  // ── 断开前置 ───────────────────────────────────────────────────────────
  it("每条前置箭头旁边有一个断开按钮", () => {
    const { document } = openPage();
    const c = card(document, "I-004");
    expect(c.querySelector('[data-unlink-from="I-002"][data-unlink-to="I-004"]')).toBeTruthy();
    expect(c.querySelector('[data-unlink-from="I-003"][data-unlink-to="I-004"]')).toBeTruthy();
  });

  it("点断开，账本记下断的是哪一条，卡片上那条也没了", () => {
    const { window, document } = openPage();
    const c = card(document, "I-004");
    c.querySelector('[data-unlink-from="I-003"][data-unlink-to="I-004"]').click();
    expect(ops(window)).toEqual([{ op: "unlink", from: "I-003", to: "I-004" }]);
    expect(c.querySelector('[data-unlink-from="I-003"]')).toBeFalsy();
    expect(c.querySelector('[data-unlink-from="I-002"]')).toBeTruthy();   // 另一条还在
  });

  // ── 连上前置 ───────────────────────────────────────────────────────────
  it("每张卡片有一个下拉框可以连一条新的前置", () => {
    const { document } = openPage();
    const pick = card(document, "I-002").querySelector('select[data-link-to="I-002"]');
    expect(pick).toBeTruthy();
    const values = [...pick.querySelectorAll("option")].map((o: any) => o.value);
    expect(values).toContain("I-003");
    expect(values).not.toContain("I-002");    // 不能连自己
    expect(values).not.toContain("I-001");    // 已经是它的前置了
  });

  it("选一个想法连上去，账本记下这条边，卡片上多一条", () => {
    const { window, document } = openPage();
    const c = card(document, "I-002");
    const pick = c.querySelector('select[data-link-to="I-002"]');
    pick.value = "I-003";
    pick.dispatchEvent(new window.Event("change", { bubbles: true }));
    expect(ops(window)).toEqual([{ op: "link", from: "I-003", to: "I-002" }]);
    expect(c.querySelector('[data-unlink-from="I-003"][data-unlink-to="I-002"]')).toBeTruthy();
  });

  // ── 新建 ───────────────────────────────────────────────────────────────
  it("有一个新建想法的按钮，点了页面上多一张卡片，编号是临时号", () => {
    const { window, document } = openPage();
    document.getElementById("new-idea").click();
    const added = ops(window);
    expect(added).toHaveLength(1);
    expect(added[0].op).toBe("add");
    expect(added[0].tmp).toMatch(/^tmp:/);
    expect(card(document, added[0].tmp), "新想法没有出现在页面上").toBeTruthy();
  });

  // 新卡片是克隆第一张卡片来的。「代码在哪」和「如何验证」那两块没有 .ro 类，
  // 所以清空循环够不着它们 —— 新想法会带着别人的代码路径和验证命令出生，
  // 而那两样正是 /ccbuild 会照着去写文件的东西。
  it("新建的卡片不带上一张卡片的代码路径和验证命令", () => {
    const { window, document } = openPage();
    document.getElementById("new-idea").click();
    const tmp = ops(window)[0].tmp;
    const text = card(document, tmp).textContent;
    expect(text, "新卡片带着别人的代码路径").not.toContain("src/base.ts");
    expect(text, "新卡片带着别人的验证命令").not.toContain("base.test.ts");
    expect(text, "新卡片带着别人的符号名").not.toContain("baseFn");
  });

  // 前三问是一个想法「成形」的最低标准，没填齐不该被提交出去。
  it("新想法前三问没填齐时被标成未完成，填齐之后标记消失", () => {
    const { window, document } = openPage();
    document.getElementById("new-idea").click();
    const tmp = ops(window)[0].tmp;
    const c = card(document, tmp);
    expect(c.classList.contains("incomplete")).toBe(true);

    for (const [f, v] of [["name", "新想法"], ["what", "W"], ["why", "Y"], ["expected", "E"]]) {
      const el = c.querySelector('[data-idea="' + tmp + '"][data-field="' + f + '"]');
      el.value = v;
      el.dispatchEvent(new window.Event("input", { bubbles: true }));
    }
    expect(c.classList.contains("incomplete")).toBe(false);
  });

  // ── 删除 ───────────────────────────────────────────────────────────────
  it("点删除是标记待删，不是立刻消失，而且可以反悔", () => {
    const { window, document } = openPage();
    const c = card(document, "I-003");
    c.querySelector('[data-remove="I-003"]').click();
    expect(c.classList.contains("removing")).toBe(true);
    expect(card(document, "I-003"), "卡片不该立刻消失").toBeTruthy();
    expect(ops(window)).toEqual([{ op: "remove", id: "I-003" }]);

    c.querySelector('[data-remove="I-003"]').click();      // 再点一次＝反悔
    expect(c.classList.contains("removing")).toBe(false);
    expect(ops(window)).toEqual([]);
  });

  // ── 重画 ───────────────────────────────────────────────────────────────
  it("结构一变就重画，而且画的是新形状", () => {
    const { window, document, drawn } = openPage();
    card(document, "I-004").querySelector('[data-unlink-from="I-003"]').click();
    expect(drawn.length, "结构变了却没有重画").toBeGreaterThan(0);
    const last = drawn[drawn.length - 1];
    expect(last).toContain("n_I_002 --> n_I_004");
    expect(last, "断掉的那条边还画在图上").not.toContain("n_I_003 --> n_I_004");
  });

  it("只改文字不改结构，不触发重画", () => {
    const { window, document, drawn } = openPage();
    const el = document.querySelector('[data-idea="I-002"][data-field="what"]');
    el.value = "改一句话";
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(drawn).toHaveLength(0);
  });

  // ── 断网 ───────────────────────────────────────────────────────────────
  // 画图要联网取一个第三方库。取不到的时候，编辑和提交必须照常，
  // 而且不能把流程图的源码当正文糊人一脸 —— 那是现在就有的毛病。
  it("画图用不了的时候，增删照常，页面明说图暂时不可用，且不露出图的源码", () => {
    const { window, document } = openPage({ redraw: false });
    expect(() =>
      card(document, "I-004").querySelector('[data-unlink-from="I-003"]').click()).not.toThrow();
    expect(ops(window)).toEqual([{ op: "unlink", from: "I-003", to: "I-004" }]);

    expect(document.body.textContent).toContain("图暂时不可用");
    // 只看图那一块：共用源码的 <script> 里本来就合法地含有这段文字，
    // 查整个 body 是一条永远不可能满足的断言。
    expect(document.querySelector(".graph").textContent, "流程图源码被当成正文显示出来了")
      .not.toContain("classDef done fill:");
  });

  // 既有的约束：想法文字一律走 textContent / value，页面脚本里不许出现 innerHTML。
  it("新加的代码没有把 innerHTML 引回来", () => {
    const html = render(graphOf(), yaml, PROJECT);
    expect(html.slice(html.indexOf('<script type="module">'))).not.toContain("innerHTML");
  });
});
