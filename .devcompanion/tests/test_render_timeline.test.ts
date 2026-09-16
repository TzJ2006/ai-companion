import { describe, it, expect } from "vitest";
import { Window } from "happy-dom";
import { parse } from "yaml";
import { render, type Graph } from "../../companion/ideas.js";

// I-134 —— 每一页最下面一块可以收起的改动时间线：这一页的想法自己加上它所有子孙的修改
// 记录，按日期从新到旧、按天分组，每条能点回那个想法；首页汇的是全项目。条目多了不分页：
// 全部渲染，旧的收进一个默认合上的折叠元素，标题写明确切的隐藏条数。
//
// 为什么要有这份测试：最容易悄悄坏掉的三处 —— 范围（把兄弟子树的记录也汇进来）、顺序
// （按写入顺序而不是按日期倒序）、折叠边界（把一天切成两半，或者隐藏条数说错）。

const graph = (extra = "") => `version: 1
project: fixture
endpoints: [I-003]
ideas:
  - id: I-001
    name: "地基"
    status: done
    needs: []
    what: 地基
    code:
      - file: src/base.ts
        lines: "1-1"
    verify: { command: "npx vitest run base.test.ts", pass: "exit 0" }
    log:
      - date: "2026-09-01"
        by: ccscan
        note: 建了
      - date: "2026-09-03"
        by: ccbuild
        note: 砌好了
  - id: I-002
    name: "中间层"
    status: doing
    needs: [I-001]
    parent: I-001
    what: 中间层
    log:
      - date: "2026-09-02"
        by: ccthink
        note: 想清楚了
      - date: "2026-09-05"
        note: 开工
  - id: I-004
    name: "梁"
    status: todo
    needs: []
    parent: I-002
    what: 梁
    log:
      - date: "2026-09-04"
        by: ccthink
        note: 梁的记录
  - id: I-003
    name: "屋顶"
    status: todo
    needs: [I-002]
    parent: I-001
    what: 屋顶
    log:
      - date: "2026-09-06"
        by: ccthink
        note: 屋顶的记录
  - id: I-009
    name: "另一棵树"
    status: todo
    needs: []
    what: 和地基无关
    log:
      - date: "2026-09-07"
        by: ccthink
        note: 别的树的记录
${extra}`;

const open = (yaml: string) => {
  const html = render(parse(yaml) as Graph, yaml, "D:/p");
  const window = new Window({ url: "file:///D:/p/ideas/graph.html" });
  const document = window.document;
  document.write("<!doctype html><html><body></body></html>");
  document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>"));
  return { html, document };
};
const text = (el: unknown) => String((el as { textContent?: string } | null)?.textContent ?? "").trim();
const tl = (document: any, page: string) => document.querySelector(`#page-${page} details.timeline`);
const rows = (block: any) => [...block.querySelectorAll(".tl-row")];

describe("I-134 每一页最下面的改动时间线", () => {
  const { document } = open(graph());

  it("想法页：汇的是它自己和它的子孙，兄弟子树的记录不进来", () => {
    const block = tl(document, "I-002");
    expect(block, "I-002 那一页没有时间线").not.toBeNull();
    const names = rows(block).map((r) => text(r.querySelector("a")));
    expect(names).toEqual(["中间层", "梁", "中间层"]);   // 09-05 开工、09-04 梁、09-02 想清楚了
    expect(text(block).includes("屋顶的记录")).toBe(false);
    expect(text(block).includes("别的树的记录")).toBe(false);
    expect(text(block.querySelector("summary"))).toContain("改动时间线 (3)");
  });

  it("从新到旧、按天分组，每条能点回那个想法", () => {
    const block = tl(document, "I-001");
    const days = [...block.querySelectorAll(".tl-day > b")].map(text);
    expect(days).toEqual(["2026-09-06", "2026-09-05", "2026-09-04", "2026-09-03", "2026-09-02", "2026-09-01"]);
    const first = rows(block)[0];
    expect(first.querySelector("a").getAttribute("href")).toBe("#I-003");
    expect(first.querySelector("a").getAttribute("data-goto")).toBe("I-003");
    expect(text(first.querySelector(".tl-note"))).toBe("ccthink — 屋顶的记录");
    // 没写 by 的那条只印说明，不印一个空的破折号。
    const started = rows(block).find((r) => text(r).includes("开工"));
    expect(text(started.querySelector(".tl-note"))).toBe("开工");
  });

  it("首页汇的是全项目", () => {
    const block = tl(document, "root");
    expect(text(block.querySelector("summary"))).toContain("改动时间线 (7)");
    expect(text(block)).toContain("别的树的记录");
    expect(block.hasAttribute("open"), "默认应该是收起的").toBe(false);
  });

  it("整块只读：没有编号、没有 data-idea、没有输入框", () => {
    const block = tl(document, "root");
    expect(block.querySelectorAll("[id], [data-idea], [data-field], [data-row], input, textarea, button").length).toBe(0);
  });

  it("没有任何修改记录的页面：一块都不出", () => {
    const bare = open(`version: 1\nproject: x\nendpoints: []\nideas:\n  - id: I-001\n    name: "a"\n    what: a\n`);
    expect(tl(bare.document, "root")).toBeNull();
  });
});

describe("I-134 条目多了：全部渲染，旧的收进合上的折叠元素", () => {
  // 25 条散在 25 天里，最新 20 条露着，5 条收起来 —— 而且切口落在天的边界上。
  const many = Array.from({ length: 25 }, (_, k) =>
    `      - date: "2026-08-${String(k + 1).padStart(2, "0")}"\n        note: 第 ${k + 1} 条\n`).join("");
  const { document } = open(graph(`  - id: I-020
    name: "忙碌的想法"
    status: todo
    needs: []
    what: 忙
    log:
${many}`));
  const block = tl(document, "I-020");

  it("标题写总数，折叠标题写确切的隐藏条数，被藏的是最旧的那几条", () => {
    expect(text(block.querySelector("summary"))).toContain("改动时间线 (25)");
    const more = block.querySelector("details.tl-more");
    expect(more, "没有「更早的」折叠").not.toBeNull();
    expect(text(more.querySelector("summary"))).toBe("更早的 5 条");
    expect(more.hasAttribute("open")).toBe(false);
    const hiddenDays = [...more.querySelectorAll(".tl-day > b")].map(text);
    expect(hiddenDays).toEqual(["2026-08-05", "2026-08-04", "2026-08-03", "2026-08-02", "2026-08-01"]);
    // 露着的最新一条是 8 月 25 日。
    expect(text(block.querySelector(".tl-day > b"))).toBe("2026-08-25");
    // 全部 25 条都在页面上，一条没丢。
    expect(rows(block).length).toBe(25);
  });

  it("刚好不超过上限时没有折叠", () => {
    const { document: d } = open(graph());
    expect(tl(d, "root").querySelector("details.tl-more")).toBeNull();
  });
});
