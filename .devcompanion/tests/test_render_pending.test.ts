import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Window } from "happy-dom";
import { parse } from "yaml";
import { render, paths, approvalSnapshot, type Graph } from "../../companion/ideas.js";

// I-103 —— 网页上印出正在等你批：口令、关卡、覆盖的想法和内容全文；面板明写只能在对话里回；
// 投影和口令文件里的摘要对不上就标「已作废」；待答目录不存在、文件读不出，页面照常渲染。
// 顺手修两处：有验证命令又签过字的想法卡片上看得见签字；test_files 在网页两个显示面都列得出来。

const YAML = `version: 1
project: fixture
endpoints: [I-002]
ideas:
  - id: I-001
    name: "地基"
    status: done
    needs: []
    what: 地基是什么
    why: 要有地基
    expected: 站得住
    how: 石头砌
    why_this_way: 耐久
    future: 能盖房
    code:
      - file: src/base.ts
    verify: { command: "npx vitest run base.test.ts", test_files: [ tests/base.test.ts ], pass: "exit 0", signed_off: "某人 2026-09-01 签过" }
  - id: I-002
    name: "终点：屋顶"
    status: todo
    needs: [I-001]
    parent: I-001
    what: 屋顶是什么
    why: 要遮雨
    expected: 不漏
    how: 用瓦
    why_this_way: 瓦便宜
    future: 住人
    code:
      - file: src/roof.ts
    verify: { manual: "亲眼看一遍", signed_off: null }
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function project(pending?: Record<string, unknown>[], garbage = false) {
  const dir = mkdtempSync(join(tmpdir(), "pend-"));
  dirs.push(dir);
  mkdirSync(join(dir, "ideas"), { recursive: true });
  writeFileSync(paths(dir).graph, YAML);
  if (pending) {
    const pdir = join(paths(dir).approvals, "pending");
    mkdirSync(pdir, { recursive: true });
    for (const p of pending) writeFileSync(join(pdir, `${p.challenge}.json`), JSON.stringify(p));
    if (garbage) writeFileSync(join(pdir, "CC-BADBAD00.json"), "{not json");
  }
  return dir;
}

const dom = (html: string) => {
  const window = new Window({ url: "file:///D:/p/ideas/graph.html" });
  const document = window.document;
  document.write("<!doctype html><html><body></body></html>");
  document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>"));
  return document;
};
const graph = () => parse(YAML) as Graph;
const text = (el: unknown) => String((el as { textContent?: string } | null)?.textContent ?? "");

describe("待答口令面板", () => {
  it("没有待答目录：没有面板；不传 projectDir 也照常渲染", () => {
    const dir = project();
    const html = render(graph(), YAML, dir);
    expect(dom(html).querySelector("details.pending")).toBeNull();
    expect(() => render(graph(), YAML, "")).not.toThrow();
    expect(() => render(graph())).not.toThrow();
  });

  it("有一份口令：面板印出口令、关卡、覆盖的想法、内容全文，和「只能在对话里回」", () => {
    const g = graph();
    const dir = project([{
      v: 2, challenge: "CC-0123ABCD", gate: "plan",
      snapshots: { "I-002": approvalSnapshot(g, "I-002") },
    }]);
    const document = dom(render(g, YAML, dir));
    const panel = document.querySelector("#page-root details.pending");
    expect(panel, "首页上没有待答面板").not.toBeNull();
    const t = text(panel);
    expect(t).toContain("CC-0123ABCD");
    expect(t).toContain("plan");
    expect(t).toContain("I-002");
    expect(t).toContain("屋顶是什么");          // 全文，不是名字
    expect(t).toContain("瓦便宜");
    expect(t).toMatch(/对话里/);                 // 边界写在人看得见的地方
    expect(t).toContain("批准 CC-0123ABCD");     // 抄进对话的那一句
    expect(t).not.toContain("已作废");
    // 全文块保留换行：不能是那种截成一行省略号的样式
    const block = panel!.querySelector(".pending-text");
    expect(block, "全文没有放在 .pending-text 块里").not.toBeNull();
    expect(panel!.hasAttribute("open"), "面板默认应收起").toBe(false);
  });

  it("内容改过了：口令标「已作废」，不让人去抄一个必然被拒的口令", () => {
    const dir = project([{
      v: 2, challenge: "CC-DEADBEEF", gate: "plan",
      snapshots: { "I-002": "000000000000" },
    }]);
    const t = text(dom(render(graph(), YAML, dir)).querySelector("details.pending"));
    expect(t).toContain("CC-DEADBEEF");
    expect(t).toContain("已作废");
  });

  it("目录里有读不出的文件：跳过它，别的照印，页面不崩", () => {
    const g = graph();
    const dir = project([{
      v: 2, challenge: "CC-00FF00FF", gate: "manual-check",
      snapshots: { "I-002": approvalSnapshot(g, "I-002") },
    }], true);
    const t = text(dom(render(g, YAML, dir)).querySelector("details.pending"));
    expect(t).toContain("CC-00FF00FF");
    expect(t).not.toContain("CC-BADBAD00");
  });

  it("磁盘上那份 graph.html（redraw 产物）不印口令：render 不传 projectDir 时没有面板", () => {
    const g = graph();
    project([{ v: 2, challenge: "CC-11112222", gate: "plan", snapshots: { "I-002": approvalSnapshot(g, "I-002") } }]);
    expect(render(g, YAML)).not.toContain("CC-11112222");
  });
});

describe("提交成功的回调把服务端送回来的口令显示出来", () => {
  it("页面脚本读 done.signs，不再只数 changed", () => {
    const html = render(graph(), YAML, project());
    const script = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
    expect(script).toMatch(/done\.signs/);
  });
});

describe("顺手修的两处显示", () => {
  it("有验证命令又签过字：卡片上看得见签字", () => {
    const document = dom(render(graph(), YAML, project()));
    const card = document.querySelector("section.idea#I-001") ?? document.getElementById("I-001");
    expect(card, "找不到 I-001 的卡片").not.toBeNull();
    expect(text(card)).toContain("某人 2026-09-01 签过");
  });

  it("test_files 在卡片和父页面的展开摘要里都列得出来", () => {
    const document = dom(render(graph(), YAML, project()));
    const card = document.querySelector("section.idea#I-001") ?? document.getElementById("I-001");
    expect(text(card)).toContain("tests/base.test.ts");
    const row = document.querySelector('#page-root .children details[data-row="I-001"]');
    expect(row, "首页上 I-001 那一行不存在").not.toBeNull();
    expect(text(row)).toContain("tests/base.test.ts");
  });
});
