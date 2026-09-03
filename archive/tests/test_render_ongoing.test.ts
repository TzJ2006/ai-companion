import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { render, type Graph } from "../../claude-companion/ideas.js";

// I-084 — 图下面一个能收起的索引：列出正在进行中的想法，以及每个在等谁。
//
// 两条容易写错的地方，各有一条测试盯着：
//
// 一、「还没做完的前置」必须写成「不等于已完成」，不能写成「等于待办」。
//    一个受阻或者进行中的前置同样挡着路，按「等于待办」筛会把它漏掉，
//    于是页面会说「没有前置挡着它」，而实际上有。这个错在今天这张真图上
//    不会显形（进行中的几个都不等前置），所以只能靠测试抓，肉眼看不出来。
//
// 二、「没有前置挡着它」这句话只能说这一件事。它**不**说明有人正在做 ——
//    实测本仓库三个进行中的想法里有两个一个前置都不等，而那两个恰恰都卡在等人签字。

const yaml = `version: 1
agent: claude
project: fixture
endpoints: [I-006]
ideas:
  - id: I-001
    name: "已经做完的地基"
    status: done
    needs: []
    what: W1
    code:
      - file: src/a.ts
    verify: { command: "npx vitest run a.test.ts", pass: "exit 0" }
  - id: I-002
    name: "还没开始的"
    status: todo
    needs: []
    what: W2
  - id: I-003
    name: "受阻的"
    status: blocked
    needs: []
    what: W3
  - id: I-004
    name: "在做，等着两个前置"
    status: doing
    needs: [I-001, I-002]
    what: W4
  - id: I-005
    name: "在做，前置是受阻的那个"
    status: doing
    needs: [I-003]
    what: W5
  - id: I-006
    name: "终点：在做，一个前置都不等"
    status: doing
    needs: []
    what: W6
`;

const graphOf = () => parse(yaml) as Graph;
const PROJECT = "D:/p";

/** 「进行中」那个索引区。 */
function ongoing(html: string): string | null {
  const at = html.indexOf("进行中 (");
  if (at < 0) return null;
  const open = html.lastIndexOf("<details", at);
  return html.slice(open, html.indexOf("</details>", at) + 10);
}
const rowOf = (box: string, id: string) => {
  const at = box.indexOf(`href="#${id}"`);
  if (at < 0) return null;
  const start = box.lastIndexOf("<div", at);
  return box.slice(start, box.indexOf("</div>", at) + 6);
};

describe("I-084 进行中的索引", () => {
  it("默认收起，没有 open 属性，也没有 name 属性", () => {
    const html = render(graphOf(), yaml, PROJECT);
    const box = ongoing(html)!;
    expect(box, "没有找到这个索引").toBeTruthy();
    expect(html).not.toContain('open="false"');
    expect(box.slice(0, box.indexOf(">"))).not.toMatch(/\bopen\b|\bname=/);
  });

  it("只列进行中的，条数和行数一致", () => {
    const box = ongoing(render(graphOf(), yaml, PROJECT))!;
    expect(box).toMatch(/进行中 \(3\)/);
    expect([...box.matchAll(/data-goto="/g)]).toHaveLength(3);
    // 查的是「有没有作为一行被列出来」，不是「文字有没有出现过」——
    // 不在做的想法完全可以作为别人的前置出现在「在等谁」里，那是对的。
    for (const id of ["I-001", "I-002", "I-003"]) {
      expect(rowOf(box, id), `${id} 不在做，不该被列成一行`).toBeNull();
    }
  });

  it("每一行都带真正的锚点地址", () => {
    const box = ongoing(render(graphOf(), yaml, PROJECT))!;
    for (const id of ["I-004", "I-005", "I-006"]) expect(box).toContain(`href="#${id}"`);
  });

  // ── 「还没做完的前置」怎么算 ────────────────────────────────────────────
  it("只列还没做完的前置 —— 已经做完的那个不该出现在「在等谁」里", () => {
    const row = rowOf(ongoing(render(graphOf(), yaml, PROJECT))!, "I-004")!;
    expect(row, "等的是没做完的那个").toContain("还没开始的");
    expect(row, "已经做完的前置不该算在等").not.toContain("已经做完的地基");
  });

  // 这一条是分水岭：按「等于待办」筛会漏掉受阻的前置，
  // 于是页面对 I-005 说「没有前置挡着它」，而它其实被 I-003 挡着。
  it("前置是受阻的，同样算在等 —— 不能只看「等于待办」", () => {
    const row = rowOf(ongoing(render(graphOf(), yaml, PROJECT))!, "I-005")!;
    expect(row, "受阻的前置被当成了不挡路").toContain("受阻的");
    expect(row).not.toContain("没有前置挡着它");
  });

  // ── 一个前置都不等的那一行 ─────────────────────────────────────────────
  it("一个前置都不等时说一句明白话，不是一个破折号", () => {
    const row = rowOf(ongoing(render(graphOf(), yaml, PROJECT))!, "I-006")!;
    expect(row).toContain("没有前置挡着它");
    // 现成那个表示「无」的破折号在这里读起来像「没有信息」，
    // 而这里要说的是一件确定的事。
    expect(row).not.toContain("—</span>");
  });

  it("完全没写 needs 的想法，和写了空 needs 的一样处理", () => {
    const g = graphOf();
    delete (g.ideas[5] as { needs?: string[] }).needs;
    const row = rowOf(ongoing(render(g, yaml, PROJECT))!, "I-006")!;
    expect(row).toContain("没有前置挡着它");
  });

  // ── 空的时候整块不出现 ─────────────────────────────────────────────────
  it("一个进行中都没有时，这一块根本不出现", () => {
    const g = graphOf();
    for (const i of g.ideas) if (i.status === "doing") i.status = "todo";
    expect(render(g, yaml, PROJECT)).not.toContain("进行中 (");
  });

  // ── 两个索引互不干扰 ───────────────────────────────────────────────────
  it("和「待人工验证」那个索引可以同时开着，互不影响", () => {
    const g = graphOf();
    g.ideas[1].verify = { manual: "人看一眼", signed_off: null };   // 造一条待签
    const html = render(g, yaml, PROJECT);
    expect(html).toContain("待人工验证 (");
    expect(html).toContain("进行中 (");
    // 没有 name 属性，两个才能同时展开；有的话浏览器会把它们做成手风琴。
    expect([...html.matchAll(/<details[^>]*\bname=/g)]).toHaveLength(0);
  });

  it("想法名字里的尖括号不会变成标签", () => {
    const g = graphOf();
    g.ideas[5].name = '<img src=x onerror=alert(1)>';
    const html = render(g, yaml, PROJECT);
    expect(html).not.toContain("<img src=x");
  });
});
