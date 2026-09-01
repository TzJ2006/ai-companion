import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { buildMermaidSource, render, type Graph } from "../../claude-companion/ideas.js";

// I-076 — 把「一张图画成流程图」这段算法抽成网页和引擎共用的一份源码。
//
// 只有一份源码：引擎求值它，页面也嵌同一段文本去求值。这份测试的正题是把页面里
// 那一段抠出来、在一个干净的作用域里独立求值，然后和引擎的输出逐字比对 ——
// 抠出来那一步很重要，它测的是「真正发出去的那份」，不是「我以为发出去的那份」。
//
// 干净作用域还顺带压住了「零闭包」：函数体一旦引用了模块里的任何东西
// （原来的写法引用了折行、净化、终点集合等六样），这里求值就会当场报错。

const yaml = `version: 1
agent: claude
project: fixture
endpoints: [I-004]
ideas:
  - id: I-001
    name: "地基"
    status: done
    needs: []
  - id: I-002
    name: "把想法按依赖顺序排列：前置的永远排在前面"
    status: doing
    needs: [I-001]
  - id: I-003
    name: 'a "quoted" (paren) <angle> name'
    status: blocked
    needs: [I-001, I-999]
  - id: I-004
    name: "终点：做完了"
    status: todo
    needs: [I-002, I-003]
`;

const graphOf = () => parse(yaml) as Graph;

/** The one shared copy, as it is actually shipped inside the page. */
function sourceFromPage(html: string): string {
  const m = html.match(/<script id="mermaid-source-fn">([\s\S]*?)<\/script>/);
  expect(m, "页面里没有嵌入共用的画图函数（id=mermaid-source-fn）").toBeTruthy();
  return m![1];
}

/** Evaluate that text in a scope that can see nothing but the globals. */
function evalShared(source: string): (g: Graph) => string {
  return new Function(`${source}\nreturn buildMermaidSource;`)() as (g: Graph) => string;
}

/** What the page actually draws. */
function diagramInPage(html: string): string {
  const m = html.match(/<pre class="mermaid">([\s\S]*?)<\/pre>/);
  expect(m, "页面里没有流程图").toBeTruthy();
  return m![1];
}

describe("I-076 网页和引擎共用同一份画图源码", () => {
  it("页面里嵌着共用的画图函数", () => {
    expect(sourceFromPage(render(graphOf(), yaml, "D:/p")).trim().length).toBeGreaterThan(200);
  });

  // 正题。页面那份在只看得见全局的作用域里求值 —— 引用了函数外任何东西都会在这里炸。
  it("页面那份和引擎那份，对同一张图输出逐字相同", () => {
    const html = render(graphOf(), yaml, "D:/p");
    const fromPage = evalShared(sourceFromPage(html));
    expect(fromPage(graphOf())).toBe(buildMermaidSource(graphOf()));
  });

  it("页面里真正画出来的那张图，就是这个函数算出来的", () => {
    const html = render(graphOf(), yaml, "D:/p");
    expect(diagramInPage(html)).toBe(buildMermaidSource(graphOf()));
  });

  // ── 输出本身要对 ──────────────────────────────────────────────────────
  it("每个想法一个节点，每条真实的边一条连线", () => {
    const out = buildMermaidSource(graphOf());
    expect(out.split("\n")[0]).toBe("flowchart TD");
    for (const id of ["I-001", "I-002", "I-003", "I-004"]) {
      expect(out, `${id} 没有节点`).toMatch(new RegExp(`n_${id.replace("-", "_")}\\[`));
    }
    expect(out).toContain("n_I_001 --> n_I_002");
    expect(out).toContain("n_I_002 --> n_I_004");
    expect(out).toContain("n_I_003 --> n_I_004");
  });

  // 悬空的边由 check 去报错；画图沿用这个文件里的约定：静默跳过。
  it("指向不存在想法的边不画出来", () => {
    expect(buildMermaidSource(graphOf())).not.toContain("I_999");
  });

  it("终点单独上色，其余按状态上色", () => {
    const out = buildMermaidSource(graphOf());
    expect(out).toMatch(/class n_I_004 endpoint;/);          // 终点压过它的 todo 状态
    expect(out).toMatch(/class n_I_001 done;/);
    expect(out).toMatch(/class n_I_002 doing;/);
    expect(out).toMatch(/class n_I_003 blocked;/);
  });

  it("每个节点都能点开对应的卡片", () => {
    const out = buildMermaidSource(graphOf());
    for (const id of ["I-001", "I-002", "I-003", "I-004"]) {
      expect(out).toContain(`call nodeClick("${id}")`);
    }
  });

  // 一行长中文名会把整张图撑宽，所以要折行。折行规则必须在函数里面 ——
  // 它正是「手抄第二份就会漂移」最典型的那种规则。
  it("长中文名按显示宽度折行", () => {
    const out = buildMermaidSource(graphOf());
    expect(out).toMatch(/n_I_002\["[^"]*<br>/);
  });

  // 想法名不全是人写的。引号会提前关掉标签，括号和尖括号会被当成流程图语法。
  it("想法名里的引号、括号、尖括号被去掉，不会破坏图的语法", () => {
    const out = buildMermaidSource(graphOf());
    const line = out.split("\n").find((l) => l.startsWith("n_I_003["))!;
    const label = line.match(/\["([\s\S]*)"\]$/)![1];
    // 折行插进去的 <br> 是我们自己加的，先去掉再看还剩什么符号。
    expect(label.replaceAll("<br>", "")).not.toMatch(/["()<>]/);
    expect(label).toContain("quoted");                       // 文字还在，只是符号没了
  });

  it("空图也能画，不抛错", () => {
    expect(() => buildMermaidSource({ version: 1, ideas: [] } as Graph)).not.toThrow();
  });
});
