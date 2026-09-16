import { describe, it, expect } from "vitest";
import { Window } from "happy-dom";
import { parse } from "yaml";
import { render, type Graph } from "../../companion/ideas.js";

// I-086 —— 页头（那一个一级标题，和它下面、图上面的那段话）讲的必须是你现在
// 正看的这一页那个想法：首页说项目，点进一个想法就说那个想法。项目那段话里
// 多出来的几段历史不删，收进一个默认收起来的折叠区域，只出现在首页；没有多余
// 的话可收时，那个折叠区域整块不输出。
//
// 为什么非要有这份测试：这一片今天零覆盖 —— 没有任何测试碰过 h1、.overview
// 或 overview 字段，而且四个渲染测试的样例图一个都没写 overview。折叠写错的
// 两个方向（永远输出一个空框 / 永远不折）都会绿着过去。

const HEAD = `version: 1
project: fixture
`;
const IDEAS = `endpoints: [I-002]
ideas:
  - id: I-001
    name: "地基"
    status: done
    needs: []
    what: |
      第一行
      第二行
  - id: I-002
    name: "终点"
    status: todo
    needs: [I-001]
    parent: I-001
`;

// 真图里的 overview 就是这种折叠写法（ideas/graph.yaml:3）：段与段之间的那个
// 空行只折成**一个**换行，不是两个。所以样例必须照这个写 —— 换成整块写法就是
// 给实现放水，一个按「空行」切的实现会在真图上一段都切不出来，折叠永远是空的。
const THREE = `${HEAD}overview: >
  第一段说清这个项目做完之后能做什么。

  第二段是历史：某次提交把旧代码移走了。

  第三段是历史：编号为什么从某处重新开始。
${IDEAS}`;
const ONE = `${HEAD}overview: >
  只有一段话，没有历史可收。
${IDEAS}`;
const NONE = `${HEAD}${IDEAS}`;

const open = (yaml: string) => {
  const html = render(parse(yaml) as Graph, yaml, "D:/p");
  const window = new Window({ url: "file:///D:/p/ideas/graph.html" });
  const document = window.document;
  document.write("<!doctype html><html><body></body></html>");
  document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>"));
  return { html, window, document };
};

/** 同上，外加把页面脚本跑起来 —— 换页是脚本干的事，不跑就只看得见首页。 */
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

describe("I-086 首页：标题下面是一句话，历史收进折叠", () => {
  const { document } = open(THREE);

  it("标题是项目名，下面那段只印第一段", () => {
    expect(text(document.querySelector("h1"))).toBe("fixture — 想法图");
    expect(text(document.querySelector("p.overview"))).toContain("第一段");
    expect(text(document.querySelector("p.overview"))).not.toContain("第二段");
  });

  it("剩下的几段进折叠区域，而且默认是收起来的", () => {
    const more = document.querySelector("details.overview-more");
    expect(more, "折叠区域没渲染出来").not.toBeNull();
    expect(text(more)).toContain("第二段");
    expect(text(more)).toContain("第三段");
    // open 是布尔属性：写成 open="false" 反而是展开的（MDN 明说的坑）。
    expect(more!.hasAttribute("open"), "折叠区域默认是展开的").toBe(false);
  });

  it("整份文档只有一个一级标题", () => {
    expect(document.querySelectorAll("h1").length).toBe(1);
  });
});

describe("I-086 点进一个想法：标题和下面那段一起换", () => {
  it("标题变成那个想法的名字，下面那段变成它的「是什么」的第一句", () => {
    const { document, goto } = boot(THREE);
    goto("I-001");
    expect(text(document.querySelector("h1"))).toBe("地基");
    expect(text(document.querySelector("p.overview"))).toBe("第一行");
    expect(text(document.querySelector("p.overview"))).not.toContain("第二行");
  });

  it("项目那段历史不跟到想法页上来", () => {
    const { document, goto } = boot(THREE);
    goto("I-001");
    expect(text(document.querySelector("p.overview"))).not.toContain("第一段");
    expect((document.querySelector("details.overview-more") as any).hidden,
      "项目的历史说明跟到想法页上来了").toBe(true);
  });

  it("浏览器标签页上那行字也跟着换（WCAG 2.4.2）", () => {
    const { document, goto } = boot(THREE);
    goto("I-001");
    expect(document.title).toContain("地基");
  });

  it("后退回首页，两样都换回去", () => {
    const { document, goto } = boot(THREE);
    goto("I-001");
    goto("");
    expect(text(document.querySelector("h1"))).toBe("fixture — 想法图");
    expect(text(document.querySelector("p.overview"))).toContain("第一段");
    expect((document.querySelector("details.overview-more") as any).hidden).toBe(false);
  });
});

describe("I-086 边界：没有多余的话可收时，折叠区域整块不输出", () => {
  // 少了这一条，一个「无条件输出一个空折叠框」的实现能通过上面每一条断言，
  // 也能通过现有四个渲染测试（它们的样例图一个都没写 overview），然后在每一页
  // 上都挂一个点开是空的框 —— 而一个空框会让人以为坏了。
  it("只有一段话：一个折叠区域都不出现", () => {
    const { document } = open(ONE);
    expect(document.querySelectorAll("details.overview-more").length).toBe(0);
    expect(text(document.querySelector("p.overview"))).toBe("只有一段话，没有历史可收。");
  });

  it("图里根本没写 overview：那段话是空的，也不出现折叠区域", () => {
    const { document } = open(NONE);
    expect(document.querySelector("p.overview")).not.toBeNull();
    expect(text(document.querySelector("p.overview"))).toBe("");
    expect(document.querySelectorAll("details.overview-more").length).toBe(0);
  });
});

describe("I-086 撞名守门：新加的东西不许踩已有的选择器", () => {
  const { html, document } = open(THREE);

  it("全文档仍然只有一处流程图源码", () => {
    // 页面脚本自己也是 querySelector("pre.mermaid") 取第一个然后清空它 ——
    // 多出来一个，被清空的是替身，真的那份源码会当正文显示出来。
    expect(document.querySelectorAll("pre.mermaid").length).toBe(1);
  });

  it("每一页第一个 section.idea 仍然是这一页那张卡片", () => {
    expect((document.querySelector("#page-I-001 > section.idea") as any).id).toBe("I-001");
  });

  it("每一页仍然默认是隐藏的", () => {
    for (const p of document.querySelectorAll("section.page")) {
      expect(p.hasAttribute("hidden")).toBe(true);
    }
  });

  it("生成的页面里一处 open=\"false\" 都没有", () => {
    expect(html).not.toContain('open="false"');
  });
});

// I-131 —— 标题和流程图之间三条要点：「是什么」首句、「预期结果」首句、算出来的图上事实。
// 一个字都不用回填；首页没有这一块；换页跟着换；对编辑、草稿、签字三套机制不可见。
const POINTS = `${HEAD}overview: >
  项目一句话。
endpoints: [I-003]
ideas:
  - id: I-001
    name: "地基"
    status: done
    needs: []
    what: |
      地基是第一行
      地基是第二行
    expected: 地基站得住
  - id: I-002
    name: "中间层"
    status: doing
    needs: [I-001]
    parent: I-001
    what: 中间层是什么
    expected: 中间层站得住
  - id: I-003
    name: "屋顶"
    status: todo
    needs: [I-002]
    parent: I-001
    what: 屋顶是什么
  - id: I-004
    name: "烟囱"
    status: todo
    needs: [I-002, I-003]
    parent: I-003
    what: 烟囱是什么
    expected: 会冒烟
`;
const points = (document: any) => [...document.querySelectorAll("#keypoints li")].map(text);

describe("I-131 每一页顶上三条要点", () => {
  it("首页没有要点块", () => {
    const { document } = boot(POINTS);
    const box = document.getElementById("keypoints");
    expect(box).not.toBeNull();
    expect(box.hasAttribute("hidden")).toBe(true);
    expect(points(document)).toEqual([]);
  });

  it("点进一个想法：恰好三条 —— 是什么首句、预期结果首句、算出来的事实", () => {
    const { document, goto } = boot(POINTS);
    goto("I-001");
    const p = points(document);
    expect(p).toHaveLength(3);
    expect(p[0]).toBe("是什么：地基是第一行");
    expect(p[0]).not.toContain("第二行");
    expect(p[1]).toBe("预期结果：地基站得住");
    expect(p[2]).toContain("已完成");
    expect(p[2]).toContain("顶层想法");
    expect(p[2]).toContain("直接子想法做完 0/2");     // 数的是直接子想法，不是整棵子树
    expect(p[2]).toContain("没有前置挡着它");
  });

  it("事实那一条按对端当前状态算：在等的是没做完的前置，不是全部链接", () => {
    const { document, goto } = boot(POINTS);
    goto("I-004");
    const p = points(document);
    expect(p[2]).toContain("归在「屋顶」下面");
    expect(p[2]).toContain("没有子想法");
    expect(p[2]).toContain("在等 2 个没做完的前置想法");   // I-002 doing、I-003 todo；I-001 已完成不算
  });

  it("没写预期结果的想法：那一条是「—」，不是空着也不是少一条", () => {
    const { document, goto } = boot(POINTS);
    goto("I-003");
    const p = points(document);
    expect(p).toHaveLength(3);
    expect(p[1]).toBe("预期结果：—");
  });

  it("换一个想法三条跟着换；退回首页整块收起", () => {
    const { document, goto } = boot(POINTS);
    goto("I-001");
    goto("I-002");
    expect(points(document)[0]).toBe("是什么：中间层是什么");
    goto("");
    expect(document.getElementById("keypoints").hasAttribute("hidden")).toBe(true);
  });

  it("要点块对编辑、草稿、签字不可见：没有编号、没有 data-*、没有输入框", () => {
    const { document, goto } = boot(POINTS);
    goto("I-001");
    const box = document.getElementById("keypoints");
    expect(box.querySelectorAll("[id], [data-idea], [data-field], [data-row], input, textarea, button").length).toBe(0);
  });
});
