import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { render, type Graph } from "../../claude-companion/ideas.js";

// I-083 — 图下面一个能收起的索引：列出所有等着人工验收签字的想法。
//
// 判断条件必须和卡片上那个签字按钮用的**完全是同一个**：没有可自动运行的验证命令，
// 并且签字栏是空的。两处判断只要不一致，就会出现「索引说这条要签，点过去卡片上
// 没有按钮」—— 而人会以为是页面坏了，不会想到是两个判断不一样。
//
// 夹具里那个「既有命令又有人工说明、且未签」的想法是分水岭：
// 按这个想法原文的说法（「验证是人工检查且签字栏为空」）它该被列出来，
// 按签字按钮实际用的判断它不该。今天这张真图上两种算法恰好都命中十二条，
// 正因为凑巧一致，分歧才更容易被漏掉。

const yaml = `version: 1
agent: claude
project: fixture
endpoints: [I-004]
ideas:
  - id: I-001
    name: "只有人能验的，还没签"
    status: todo
    needs: []
    what: W1
    code:
      - file: src/a.ts
    verify:
      manual: "在一台没装过的机器上走一遍，确认五个命令都调得起来"
      signed_off: null
  - id: I-002
    name: "只有人能验的，已经签了"
    status: doing
    needs: []
    what: W2
    code:
      - file: src/b.ts
    verify:
      manual: "人看一眼报告"
      signed_off: "某人 2026-08-01 —— 看过了"
  - id: I-003
    name: "机器能验的"
    status: todo
    needs: []
    what: W3
    code:
      - file: src/c.ts
    verify: { command: "npx vitest run c.test.ts", pass: "exit 0" }
  - id: I-004
    name: "终点：既有命令又有人工说明，而且没签"
    status: todo
    needs: [I-001]
    what: W4
    code:
      - file: src/d.ts
    verify:
      command: "npx vitest run d.test.ts"
      manual: "顺便人也看一眼"
      signed_off: null
`;

const graphOf = () => parse(yaml) as Graph;
const PROJECT = "D:/p";

/** 图下面那个索引区，从 <details> 到它的收尾。 */
function worklist(html: string): string | null {
  const at = html.indexOf("待人工验证");
  if (at < 0) return null;
  const open = html.lastIndexOf("<details", at);
  return html.slice(open, html.indexOf("</details>", at) + 10);
}

describe("I-083 等人工验收的索引", () => {
  it("默认是收起的，而且不是用 open=\"false\" 收起的", () => {
    const html = render(graphOf(), yaml, PROJECT);
    const box = worklist(html)!;
    expect(box, "没有找到这个索引").toBeTruthy();
    // open="false" 在浏览器里是**展开**的 —— 有这个属性就算展开。
    expect(html).not.toContain('open="false"');
    expect(box.slice(0, box.indexOf(">"))).not.toMatch(/\bopen\b/);
  });

  // 两个索引是两份并排的待办清单，人会同时打开看，所以不能做成手风琴。
  it("没有 name 属性 —— 两个索引可以同时开着", () => {
    expect(worklist(render(graphOf(), yaml, PROJECT))!).not.toMatch(/<details[^>]*\bname=/);
  });

  // ── 判断条件 ───────────────────────────────────────────────────────────
  it("只列出「没有验证命令、且签字栏为空」的那些 —— 和签字按钮同一个判断", () => {
    const box = worklist(render(graphOf(), yaml, PROJECT))!;
    expect(box, "该列的没列").toContain("只有人能验的，还没签");
    expect(box, "已经签过的不该列").not.toContain("已经签了");
    expect(box, "机器能验的不该列").not.toContain("机器能验的");
    // 分水岭：它有命令，所以卡片上没有签字按钮，索引也就不该列它 ——
    // 按这个想法原来的说法它会被列出来，那样索引就指向一张点不了的卡片。
    expect(box, "既有命令又有人工说明的不该列 —— 它的卡片上没有签字按钮")
      .not.toContain("既有命令又有人工说明");
  });

  it("索引里的条数和真正列出来的行数一致", () => {
    const box = worklist(render(graphOf(), yaml, PROJECT))!;
    const rows = [...box.matchAll(/data-goto="/g)].length;
    expect(rows).toBe(1);
    expect(box).toMatch(/待人工验证[^<]*\(1\)/);        // 数字不是写死的
  });

  // ── 每一行 ─────────────────────────────────────────────────────────────
  it("每一行显示名字和那条人工检查的原文", () => {
    const box = worklist(render(graphOf(), yaml, PROJECT))!;
    expect(box).toContain("只有人能验的，还没签");
    expect(box, "没写清楚要人去看什么").toContain("在一台没装过的机器上走一遍");
  });

  // 那个平滑滚动的跳转函数住在需要联网取画图库的模块里；双击打开又没网时
  // 整个模块不执行。锚点才是四种情况下都管用的那条路。
  it("每一行都带真正的锚点地址，不只靠脚本跳转", () => {
    const box = worklist(render(graphOf(), yaml, PROJECT))!;
    expect(box).toContain('href="#I-001"');
    expect(box).toContain('data-goto="I-001"');
  });

  // ── 不能劫持签字按钮 ───────────────────────────────────────────────────
  // 索引排在卡片前面。行里要是也带上签字按钮的那个标记，
  // 现有签字测试里五处 querySelector 会先找到索引里的那个，
  // 于是五条断言全部在测另一个东西 —— 而且仍然是绿的。
  it("索引行上没有签字按钮的标记，全页每个编号只有一个", () => {
    const html = render(graphOf(), yaml, PROJECT);
    expect([...html.matchAll(/data-sign="I-001"/g)]).toHaveLength(1);
    expect(worklist(html)!).not.toContain("data-sign");
  });

  // ── 空的时候整块不出现 ─────────────────────────────────────────────────
  it("一条都不用签的时候，这一块根本不出现", () => {
    const g = graphOf();
    g.ideas[0].verify = { manual: "人看一眼", signed_off: "某人 2026-01-01 —— 看过了" };
    const html = render(g, yaml, PROJECT);
    expect(html, "写着（0）的空框会让人点进去看，然后发现什么都没有")
      .not.toContain("待人工验证");
  });

  // ── 想法里的文字不全是人写的 ───────────────────────────────────────────
  it("人工检查的原文里有尖括号也不会变成标签", () => {
    const g = graphOf();
    g.ideas[0].verify = { manual: '看 <img src=x onerror=alert(1)> 这个', signed_off: null };
    const html = render(g, yaml, PROJECT);
    expect(html).not.toContain("<img src=x");
    expect(worklist(html)!).toContain("&lt;img");
  });

  // ── 不能撞坏现有的东西 ─────────────────────────────────────────────────
  it("索引排在详情卡片前面，而且没有动卡片的定位方式", () => {
    const html = render(graphOf(), yaml, PROJECT);
    expect(html.indexOf("待人工验证")).toBeLessThan(html.indexOf('<div id="cards">'));
    expect(html.indexOf('<div id="cards">')).toBeLessThan(html.indexOf('id="I-001"'));
  });

  it("页面脚本里仍然没有 innerHTML", () => {
    const html = render(graphOf(), yaml, PROJECT);
    expect(html.slice(html.indexOf('<script type="module">'))).not.toContain("innerHTML");
  });
});
