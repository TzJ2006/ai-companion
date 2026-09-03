import { describe, it, expect } from "vitest";
import { Window } from "happy-dom";
import { parse } from "yaml";
import { render, type Graph } from "../../companion/ideas.js";

// H16 — 两份引擎分了叉：`80fa56a` 在 claude-companion 里修好的「恢复草稿面板」
// 那个毛病，共同基座里原样留着。这份测试把它搬进基座，别再修一次丢一次。
//
// 毛病本身：那条「草稿过期」的提示被放进了行的列表里，而「收起面板」的条件是
// 「列表里一个孩子都不剩」—— 提示永远是个孩子，于是无论点恢复还是丢弃，面板
// 都不消失，草稿也永远不会从浏览器存储里清掉；另一头是恢复完无条件清草稿，
// 把刚恢复进账本的东西在下次刷新时丢干净。
//
// 顺带一条：页面在没有本地服务时打印的那句「然后跑什么」得说共同基座
// （D14 的 `.companion/` 插件根 + D34 的单文件产物），不是旧引擎。

const yaml = `version: 1
project: fixture
endpoints: [I-003]
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
    name: "终点"
    status: todo
    needs: [I-002]
    what: W3
`;

const graphOf = () => parse(yaml) as Graph;

/** 把页面装进 DOM，并在脚本跑起来之前先塞一份草稿进存储。 */
function openWith(draft: (key: string, digest: string) => unknown) {
  const html = render(graphOf(), yaml, "D:/p");
  const window = new Window({ url: "file:///D:/p/ideas/graph.html" });
  const document = window.document;
  document.write("<!doctype html><html><body></body></html>");
  document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>"));

  const el = document.getElementById("graph-data")!;
  const key = el.dataset.draftKey!;
  window.localStorage.setItem(key, JSON.stringify(draft(key, el.dataset.fingerprint!)));

  for (const id of ["mermaid-source-fn", "ledger-fn"]) {
    (window as any).eval(document.getElementById(id)!.textContent);
  }
  const blocks = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  (window as any).eval(blocks.find((b) => b.includes("createLedger"))!);
  return { window, document, key };
}

const staleDraft = () => ({
  v: 1, project: "D:/p", baseDigest: "000000000000",      // 和当前图对不上 = 过期
  ops: [{ op: "set", id: "I-002", field: "how", old: "H2", new: "上次没提交的改动" }],
});
const freshDraft = (_k: string, digest: string) => ({
  v: 1, project: "D:/p", baseDigest: digest,
  ops: [{ op: "set", id: "I-002", field: "how", old: "H2", new: "上次没提交的改动" }],
});

describe("companion base：恢复草稿的面板（H16 从 claude-companion 搬过来的修复）", () => {
  it("过期的草稿：提示进面板，不进行列表", () => {
    const { document } = openWith(staleDraft);
    expect(document.getElementById("restore")!.hidden, "有草稿时面板该出现").toBe(false);
    // 查面板本身，不查 document.body.textContent —— 那句提示作为字符串字面量
    // 就写在页面脚本里，而 body 的文本内容包含 <script> 的源码，永远「包含」它。
    expect(document.getElementById("restore")!.textContent).toContain("对着另一个版本的图写的");
    // 一条 op 就该只有一行；提示混进列表，done() 就永远数不到零。
    expect(document.querySelectorAll("#restore-list > div").length,
      "过期提示挤进了行列表").toBe(1);
  });

  it("过期的草稿：点「丢弃」之后面板收起，存储里的草稿也清掉", () => {
    const { window, document, key } = openWith(staleDraft);
    const panel = document.getElementById("restore")!;
    const buttons = [...document.querySelectorAll("#restore-list button")];
    (buttons.find((b: any) => b.textContent === "丢弃") as any).click();

    expect(panel.hidden, "丢弃完面板还赖着不走").toBe(true);
    expect(window.localStorage.getItem(key), "草稿没被清掉，刷新又会冒出来").toBeNull();
  });

  it("过期的草稿：点「恢复」之后面板也要收起，并且改动真的进了账本", () => {
    const { window, document, key } = openWith(staleDraft);
    const buttons = [...document.querySelectorAll("#restore-list button")];
    (buttons.find((b: any) => b.textContent === "恢复") as any).click();

    expect(document.getElementById("restore")!.hidden, "恢复完面板还赖着不走").toBe(true);
    expect(document.getElementById("draft-count")!.textContent, "恢复的改动没进账本").toBe("1");
    // 恢复之后账本会立刻写一份新草稿 —— 那是对着当前这张图的，不该再是过期的那份。
    expect(JSON.parse(window.localStorage.getItem(key)!).baseDigest)
      .toBe(document.getElementById("graph-data")!.dataset.fingerprint);
  });

  it("没过期的草稿一样能丢干净 —— 这条以前就是好的，别改坏了", () => {
    const { window, document, key } = openWith(freshDraft);
    expect(document.getElementById("restore")!.textContent).not.toContain("对着另一个版本的图写的");
    const buttons = [...document.querySelectorAll("#restore-list button")];
    (buttons.find((b: any) => b.textContent === "丢弃") as any).click();
    expect(document.getElementById("restore")!.hidden).toBe(true);
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("没有本地服务时，页面让人跑的是共同基座，不是旧引擎", () => {
    const html = render(graphOf(), yaml, "D:/p");
    expect(html).not.toContain("claude-companion/ideas.ts");
    expect(html).toContain("node .companion/companion.mjs apply");
  });
});
