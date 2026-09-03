import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { parse } from "yaml";
import { render, type Graph } from "../../claude-companion/ideas.js";

// I-062 — 在网页上直接修改一个想法的文字和状态。
// 网页从只读变成可编辑：八个问题的文字、名称、状态都能在浏览器里改，
// 改动被标记出来并一直留着，等待提交。行为要靠人在浏览器里点，
// 单元测试能锁住的是「页面真的发出了这些行为所依赖的东西」。

const PROJECT_DIR = "D:/GitHub/fixture-project";

const yaml = `version: 1
agent: claude
project: fixture
endpoints: [I-003]
ideas:
  - id: I-001
    name: "地基"
    status: done
    needs: []
    what: W1
    why: Y1
    expected: E1
    how: H1
    why_this_way: T1
    future: F1
    code:
      - file: src/base.ts
        symbol: base
        lines: "1-20"
    verify: { command: "npx vitest run t.test.ts", pass: "exit 0" }
  - id: I-002
    name: "中间层"
    status: todo
    needs: [I-001]
    what: W2
    why: Y2
    expected: E2
    how: H2
    why_this_way: T2
    future: F2
    code:
      - file: src/mid.ts
        symbol: mid
    verify: { command: "npx vitest run m.test.ts", pass: "exit 0" }
  - id: I-003
    name: "终点：做完了"
    status: blocked
    needs: [I-002]
    what: W3
    why: Y3
    expected: E3
    how: H3
    why_this_way: T3
    future: F3
    verify: { manual: "人看一眼", signed_off: null }
`;

const graphOf = () => parse(yaml) as Graph;
const hash12 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);

/** The embedded data model, as the page would parse it. */
function dataBlock(html: string): { attrs: string; json: any } {
  const m = html.match(/<script type="application\/json" id="graph-data"([^>]*)>([\s\S]*?)<\/script>/);
  expect(m, "页面里没有 id=graph-data 的 JSON 数据模型").toBeTruthy();
  return { attrs: m![1], json: JSON.parse(m![2]) };
}

/** One idea's detail card. */
function cardOf(html: string, id: string): string {
  const start = html.indexOf(`id="${id}"`);
  expect(start, `没有 ${id} 的详情卡片`).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</section>", start));
}

const pageScript = (html: string) => html.slice(html.indexOf('<script type="module">'));

describe("I-062 网页上直接编辑想法", () => {
  // 页面唯一的数据模型是嵌进去的 JSON，DOM 只是它的视图。
  // 从展示文字反解析必丢结构（code 和 verify 的展示串是拼出来的）。
  it("嵌入整张图的 JSON 作为页面的数据模型", () => {
    const { json } = dataBlock(render(graphOf(), yaml, PROJECT_DIR));
    expect(json.ideas.map((i: any) => i.id)).toEqual(["I-001", "I-002", "I-003"]);
    expect(json.ideas[1].how).toBe("H2");
    expect(json.ideas[1].why_this_way).toBe("T2");
    expect(json.ideas[0].code).toEqual([{ file: "src/base.ts", symbol: "base", lines: "1-20" }]);
    expect(json.ideas[2].verify).toEqual({ manual: "人看一眼", signed_off: null });
    expect(json.ideas[2].status).toBe("blocked");
  });

  // 提交的时候要能发现「图在你编辑期间被别人改过了」。
  it("嵌入当前图内容的 12 位指纹，供提交时做过期检查", () => {
    const { attrs } = dataBlock(render(graphOf(), yaml, PROJECT_DIR));
    expect(attrs).toContain(`data-fingerprint="${hash12(yaml)}"`);
  });

  // CRLF 签出的仓库和 LF 签出的仓库是同一张图，指纹必须一样，
  // 否则 Windows 上每次提交都会误报「图被改过了」。
  it("指纹对换行方式不敏感", () => {
    const crlf = yaml.replaceAll("\n", "\r\n");
    const { attrs } = dataBlock(render(graphOf(), crlf, PROJECT_DIR));
    expect(attrs).toContain(`data-fingerprint="${hash12(yaml)}"`);
  });

  // file:// 下所有本地网页共享同一个浏览器存储，两个项目的 graph.html
  // 会撞在一起。键按项目路径分命名空间。
  it("草稿的存储键按项目路径分命名空间", () => {
    const { attrs } = dataBlock(render(graphOf(), yaml, PROJECT_DIR));
    expect(attrs).toContain(`data-draft-key="aidev-ideas-draft:${hash12(PROJECT_DIR)}"`);
    const other = dataBlock(render(graphOf(), yaml, "D:/GitHub/other-project"));
    expect(other.attrs).not.toContain(hash12(PROJECT_DIR));
  });

  it("每张卡片都有编辑开关，八个问题里的散文字段都能改", () => {
    const html = render(graphOf(), yaml, PROJECT_DIR);
    for (const id of ["I-001", "I-002", "I-003"]) {
      const card = cardOf(html, id);
      expect(card, `${id} 没有编辑开关`).toMatch(new RegExp(`data-edit="${id}"`));
      expect(card).toMatch(new RegExp(`<input[^>]+data-idea="${id}"[^>]+data-field="name"`));
      for (const field of ["what", "why", "expected", "how", "why_this_way", "future"]) {
        expect(card, `${id} 的 ${field} 不是多行输入框`)
          .toMatch(new RegExp(`<textarea[^>]+data-idea="${id}"[^>]+data-field="${field}"`));
      }
    }
  });

  it("状态是下拉框，四个状态都在里面，当前状态被选中", () => {
    const html = render(graphOf(), yaml, PROJECT_DIR);
    const card = cardOf(html, "I-003");
    const select = card.slice(card.indexOf("<select"), card.indexOf("</select>") + 9);
    expect(select).toMatch(/data-field="status"/);
    for (const s of ["todo", "doing", "done", "blocked"]) {
      expect(select).toContain(`value="${s}"`);
    }
    expect(select).toMatch(/value="blocked"\s+selected/);
  });

  // 输入框里放的是想法原文，不是转义后的展示串 —— 否则人一按保存
  // 就把 &lt; 写回了图里。
  it("输入框的初值是想法原文", () => {
    const html = render(graphOf(), yaml, PROJECT_DIR);
    const card = cardOf(html, "I-002");
    expect(card).toMatch(/<textarea[^>]+data-field="how"[^>]*>H2<\/textarea>/);
    expect(card).toMatch(/<input[^>]+data-field="name"[^>]+value="中间层"/);
  });

  // 图里的文字不全是人写的。一个能终止 script 标签或 textarea 的想法名
  // 不能变成页面上可执行的东西。
  it("恶意的想法文字既跑不出 JSON 块，也跑不出输入框", () => {
    const g = graphOf();
    g.ideas[1].name = '</script><img src=x onerror=alert(1)>';
    g.ideas[1].what = '</textarea><script>alert(2)</script>';
    const html = render(g, yaml, PROJECT_DIR);

    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<script>alert(2)</script>");
    expect(html).not.toContain("</textarea><script");        // 想法文字关不掉输入框
    // 输入框里装的是转义后的文字：浏览器解码回原文，解析器却看不到标签。
    expect(html).toMatch(
      /data-field="what"[^>]*>&lt;\/textarea&gt;&lt;script&gt;alert\(2\)&lt;\/script&gt;<\/textarea>/);

    const { json } = dataBlock(html);                       // 仍然解析得出来
    expect(json.ideas[1].name).toBe('</script><img src=x onerror=alert(1)>');
    expect(json.ideas[1].what).toBe('</textarea><script>alert(2)</script>');
  });

  // 赋值一律走 textContent / value。页面脚本里出现 innerHTML，
  // 就是把想法文字当 HTML 用的路子又开了一条。
  it("页面脚本从不使用 innerHTML", () => {
    expect(pageScript(render(graphOf(), yaml, PROJECT_DIR))).not.toContain("innerHTML");
  });

  it("改过的地方有可见标记，页面顶上有未提交改动的计数", () => {
    const html = render(graphOf(), yaml, PROJECT_DIR);
    expect(html).toMatch(/\.dirty\b/);                      // 改动的可见样式
    expect(html).toContain("未提交的改动");                   // 顶部横幅
    expect(pageScript(html)).toMatch(/classList\.(add|toggle)\("dirty"/);
  });

  // 存不进去（隐私窗口、禁用站点数据）不能让页面挂掉，只能降级。
  it("浏览器本地存储只当草稿用，存取全部包 try/catch，存不了就明说关页即丢", () => {
    const script = pageScript(render(graphOf(), yaml, PROJECT_DIR));
    expect(script).toContain("localStorage");
    for (const call of script.match(/localStorage\.\w+/g) ?? []) {
      const at = script.indexOf(call);
      const before = script.slice(Math.max(0, at - 400), at);
      expect(before.lastIndexOf("try"), `${call} 不在 try/catch 里`).toBeGreaterThan(-1);
    }
    expect(script).toContain("关页即丢");
  });

  // file:// 下别的本地网页也能往同一个存储里写。恢复草稿必须人点头，
  // 否则别人写进来的东西会被当成人的改动。
  it("草稿恢复要人逐条确认，不会静默套用", () => {
    const script = pageScript(render(graphOf(), yaml, PROJECT_DIR));
    expect(script).toMatch(/data-restore/);
    // 读出来之后不能直接进数据模型 —— 中间必须隔着一次人的点击。
    const read = script.slice(script.indexOf("localStorage.getItem"));
    expect(read.slice(0, read.indexOf("addEventListener"))).not.toMatch(/applyChange\(/);
  });
});
