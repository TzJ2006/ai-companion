import { describe, it, expect } from "vitest";
import { Window } from "happy-dom";
import { parse } from "yaml";
import { render, type Graph } from "../../companion/ideas.js";

// I-117 —— 父页面上每一行子想法能原地展开看八问；展开的是只读摘要，不是卡片；
// 「进入 →」是行里一个单独的链接；图上点节点不跳页，而是定位到本页那一行。
//
// 为什么要有这份测试：现在一行是一个整体链接（`<a class="brief">`），点哪儿都跳页；
// 改成折叠元素之后，最容易悄悄坏掉的三件事分别是 —— 展开块里混进了带编号的可编辑
// 元素（编辑、草稿、签字三套机制按编号找元素，第二份会被静默认错）、网页上新建想法时
// 造出来的还是旧结构的行、以及改名时同步行名的那一行选择器还指着旧结构。这三处各钉一条。

const HEAD = `version: 1
project: fixture
endpoints: [I-003]
ideas:
`;
const IDEAS = `  - id: I-001
    name: "地基"
    status: done
    needs: []
    what: |
      第一行
      第二行
    why: 因为要有地基
    expected: 地基站得住
    how: 用石头砌
    why_this_way: 石头比木头耐久
    future: 上面能盖房
    code:
      - file: src/base.ts
        symbol: base
        lines: "1-3"
    verify: { command: "npx vitest run base.test.ts", pass: "exit 0" }
    log:
      - date: "2026-09-06"
        by: ccbuild
        note: 砌好了
  - id: I-002
    name: "中间层"
    status: todo
    needs: [I-001]
    parent: I-001
    what: 中间层是什么
    why: 中间层为什么
    expected: 中间层预期
  - id: I-003
    name: "终点：屋顶"
    status: todo
    needs: [I-002]
    parent: I-001
    what: 屋顶
    verify: { manual: "亲眼看一遍", signed_off: null }
`;
const THREE = HEAD + IDEAS;

const open = (yaml: string) => {
  const html = render(parse(yaml) as Graph, yaml, "D:/p");
  const window = new Window({ url: "file:///D:/p/ideas/graph.html" });
  const document = window.document;
  document.write("<!doctype html><html><body></body></html>");
  document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>"));
  return { html, window, document };
};

/** 同上，外加把页面脚本跑起来 —— 定位到行、新建想法、改名同步都是脚本干的事。 */
const boot = (yaml: string) => {
  const ctx = open(yaml);
  const { html, window, document } = ctx;
  for (const id of ["mermaid-source-fn", "ledger-fn"]) {
    (window as any).eval(document.getElementById(id)!.textContent);
  }
  const blocks = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  (window as any).eval(blocks.find((b) => b.includes("createLedger"))!);
  const goto = (id: string) => {
    window.location.hash = id;
    window.dispatchEvent(new window.Event("hashchange"));
  };
  return { ...ctx, goto };
};

const text = (el: unknown) => String((el as { textContent?: string } | null)?.textContent ?? "").trim();
const row = (document: any, page: string, id: string) =>
  document.querySelector(`#page-${page} .children details[data-row="${id}"]`);

describe("I-117 收着的时候：一行还是名字、状态、第一句，外加一个单独的「进入」链接", () => {
  const { html, document } = open(THREE);

  it("每一行是一个折叠元素，带 data-row，默认收起", () => {
    const r = row(document, "root", "I-001");
    expect(r, "首页上 I-001 那一行没渲染成折叠元素").not.toBeNull();
    expect(r.tagName.toLowerCase()).toBe("details");
    // open 是布尔属性：写成 open="false" 反而是展开的。
    expect(r.hasAttribute("open"), "行默认应该是收起的").toBe(false);
    expect(html).not.toContain('open="false"');
  });

  it("概要那一行有名字、状态和「是什么」的第一句", () => {
    const summary = row(document, "root", "I-001").querySelector("summary");
    expect(summary).not.toBeNull();
    expect(text(summary.querySelector(".bname"))).toBe("地基");
    expect(text(summary.querySelector(".badge"))).toBe("已完成");
    expect(text(summary.querySelector(".blurb"))).toBe("第一行");
    expect(text(summary.querySelector(".blurb"))).not.toContain("第二行");
  });

  it("「进入 →」是概要行里一个单独的链接，指向那个想法自己的页面", () => {
    const enter = row(document, "root", "I-001").querySelector("summary a[data-brief=\"I-001\"]");
    expect(enter, "进入链接不在概要行里").not.toBeNull();
    expect(enter.getAttribute("href")).toBe("#I-001");
    expect(text(enter)).toContain("进入");
  });

  it("同一层的行仍按依赖顺序排", () => {
    const ids = [...document.querySelectorAll("#page-I-001 .children details[data-row]")]
      .map((d: any) => d.getAttribute("data-row"));
    expect(ids).toEqual(["I-002", "I-003"]);
  });
});

describe("I-117 展开之后：八问、前置、后继、修改记录都在，而且是只读的", () => {
  const { document } = open(THREE);

  it("展开块里印着八问的标签和全文", () => {
    const detail = row(document, "root", "I-001").querySelector(".brief-detail");
    expect(detail, "没有展开块").not.toBeNull();
    const body = text(detail);
    for (const label of ["是什么", "为什么有这个想法", "预期结果", "如何实现", "为什么这样实现", "代码在哪", "如何验证", "未来怎么用"]) {
      expect(body, `缺了「${label}」这一问`).toContain(label);
    }
    expect(body).toContain("第二行");                 // 展开之后是全文，不只第一句
    expect(body).toContain("因为要有地基");
    expect(body).toContain("石头比木头耐久");
    expect(body).toContain("src/base.ts");            // 第 6 问
    expect(body).toContain("npx vitest run base.test.ts");   // 第 7 问
    expect(body).toContain("砌好了");                  // 修改记录
  });

  it("展开块里有前置和后继，都是跳页的链接", () => {
    const detail = row(document, "I-001", "I-002").querySelector(".brief-detail");
    const body = text(detail);
    expect(body).toContain("前置想法");
    expect(body).toContain("它是这些想法的前置");
    expect(detail.querySelector('a[href="#I-001"]'), "前置 I-001 该是一个链接").not.toBeNull();
    expect(detail.querySelector('a[href="#I-003"]'), "后继 I-003 该是一个链接").not.toBeNull();
  });

  it("人工验收的想法：展开块里写着要看什么，但没有签字按钮", () => {
    const detail = row(document, "I-001", "I-003").querySelector(".brief-detail");
    expect(text(detail)).toContain("亲眼看一遍");
    expect(detail.querySelector("button")).toBeNull();
  });

  it("展开块对编辑、草稿、签字三套机制不可见：没有输入框、没有按钮、没有编号标记", () => {
    for (const [page, id] of [["root", "I-001"], ["I-001", "I-002"], ["I-001", "I-003"]]) {
      const detail = row(document, page, id).querySelector(".brief-detail");
      expect(detail.querySelectorAll("textarea, input, select, button").length, `${id} 的展开块里有可编辑元素`).toBe(0);
      expect(detail.querySelectorAll("[data-idea], [data-edit], [data-remove], [data-sign], [data-field]").length, `${id} 的展开块里有按编号定位的标记`).toBe(0);
      expect(detail.querySelectorAll("[id]").length, `${id} 的展开块里有带 id 的元素`).toBe(0);
      expect(detail.querySelectorAll("section.idea").length).toBe(0);
    }
  });

  it("带编号的可编辑卡片全篇仍然只出现一次，就在它自己那一页上", () => {
    for (const id of ["I-001", "I-002", "I-003"]) {
      expect(document.querySelectorAll(`section.idea#${id.replace("-", "\\-")}`).length).toBe(1);
      expect((document.querySelector(`#page-${id} > section.idea`) as any).id).toBe(id);
    }
  });

  it("没有子想法的页面上一个折叠行都没有", () => {
    expect(document.querySelectorAll("#page-I-002 .children details[data-row]").length).toBe(0);
    expect(document.querySelectorAll("#page-I-003 .children details[data-row]").length).toBe(0);
  });
});

describe("I-117 图上点节点：定位到本页那一行，不跳页", () => {
  it("focusRow 打开对应那一行、打上一闪的标记，地址栏不变", () => {
    const { window, document, goto } = boot(THREE);
    goto("I-001");
    const before = window.location.hash;
    const hit = (window as any).focusRow("I-002");
    expect(hit, "本页有这一行，focusRow 该返回真").toBe(true);
    const r = row(document, "I-001", "I-002");
    expect(r.hasAttribute("open"), "对应那一行没被展开").toBe(true);
    expect(r.classList.contains("flash"), "对应那一行没打上一闪的标记").toBe(true);
    expect(window.location.hash, "定位不该换页").toBe(before);
  });

  it("展开一行不影响别的行", () => {
    const { window, document, goto } = boot(THREE);
    goto("I-001");
    (window as any).focusRow("I-002");
    expect(row(document, "I-001", "I-002").hasAttribute("open")).toBe(true);
    expect(row(document, "I-001", "I-003").hasAttribute("open")).toBe(false);
  });

  it("本页没有这一行时退回换页，这是画图模块以前的行为", () => {
    const { window } = boot(THREE);
    // 首页只有 I-001 一行；I-003 在 I-001 的页面上。
    const hit = (window as any).focusRow("I-003");
    expect(hit).toBe(false);
    expect(window.location.hash).toBe("#I-003");
  });
});

describe("I-117 脚本造出来的行也是新结构", () => {
  it("在网页上新建一个想法，父页面上多出来的那一行是折叠元素，进入链接指向临时号", () => {
    const { window, document, goto } = boot(THREE);
    goto("I-001");
    (document.getElementById("new-idea") as any).click();
    const r = document.querySelector('#page-I-001 .children details[data-row^="tmp:"]');
    expect(r, "新建想法之后父页面上没有出现折叠行").not.toBeNull();
    const tmp = r!.getAttribute("data-row")!;
    const enter = r!.querySelector(`summary a[data-brief="${tmp}"]`);
    expect(enter, "新行里没有进入链接").not.toBeNull();
    expect(enter!.getAttribute("href")).toBe("#" + tmp);
    expect(r!.querySelector(".brief-detail"), "新行里没有展开块").not.toBeNull();
    void window;
  });

  it("改了名字，父页面上那一行的名字跟着变", () => {
    const { window, document, goto } = boot(THREE);
    goto("I-001");
    (document.getElementById("new-idea") as any).click();
    const tmp = document.querySelector('#page-I-001 .children details[data-row^="tmp:"]')!.getAttribute("data-row")!;
    const input = document.querySelector(`[data-idea="${tmp}"][data-field="name"]`) as any;
    expect(input, "新想法的名字输入框不在").not.toBeNull();
    input.value = "刚起的名字";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(text(row(document, "I-001", tmp).querySelector(".bname"))).toBe("刚起的名字");
  });
});
