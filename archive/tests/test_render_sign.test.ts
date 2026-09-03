import { describe, it, expect } from "vitest";
import { Window } from "happy-dom";
import { parse } from "yaml";
import { applyChanges, render, fingerprint, type Graph } from "../../claude-companion/ideas.js";

// I-081 — 在网页上给人工验证签字，签的是人自己打的那句话。
//
// 两半各测各的：引擎那半（第七种操作怎么落进图、什么情况下拒绝）用纯函数直接跑；
// 网页那半（谁该出现签字入口、点开之后看得见什么）装进真 DOM 里点。
//
// 最要紧的一条不是「能签」，是「签的是一件具体的事」：点开签字必须先看见那条
// 人工检查的原文。要人翻到别处去找那句话才能签，和随手点「我同意」没有区别。

const TODAY = "2026-08-31";

const yaml = `version: 1
agent: claude
project: fixture
endpoints: [ I-003 ]

ideas:

  - id: I-001
    name: "机器能验的"
    status: todo
    needs: []
    what: >
      W1
    code:
      - file: src/a.ts
    verify: { command: "npx vitest run a.test.ts", pass: "exit 0" }

  - id: I-002
    name: "只有人能验的"
    status: todo
    needs: []
    what: >
      W2
    code:
      - file: src/b.ts
    verify:
      manual: "在一台没装过的机器上走一遍，确认五个命令都调得起来"
      signed_off: null

  - id: I-003
    name: "终点：已经签过字的"
    status: todo
    needs: [ I-001, I-002 ]
    what: >
      W3
    code:
      - file: src/c.ts
    verify:
      manual: "人看一眼报告"
      signed_off: "某人 2026-08-01 —— 看过了"
`;

const graphOf = () => parse(yaml) as Graph;
const envelope = (ops: unknown[]) => ({ v: 1, project: "D:/p", baseDigest: fingerprint(yaml), ops });

describe("I-081 网页签字 —— 引擎这半", () => {
  it("签字落成和手工录入一样的格式：名字、日期、原话都在", () => {
    const r = applyChanges(yaml, envelope([
      { op: "sign", id: "I-002", who: "Zijia Tang", words: "装过了，五个命令都在，hook 真的拦得住" },
    ]), TODAY);
    expect(r.ok, r.reason).toBe(true);
    const block = r.text!.slice(r.text!.indexOf("id: I-002"), r.text!.indexOf("id: I-003"));
    expect(block).toContain("Zijia Tang");
    expect(block).toContain(TODAY);
    expect(block).toContain("装过了，五个命令都在，hook 真的拦得住");
    expect(block, "没写明这是在网页上签的").toContain("网页");
    expect(block).not.toContain("signed_off: null");
  });

  it("签完之后就能标成完成了 —— 这正是签字的意义", () => {
    const signed = applyChanges(yaml, envelope([
      { op: "sign", id: "I-002", who: "人", words: "验过了" },
    ]), TODAY).text!;
    const r = applyChanges(signed, {
      v: 1, project: "D:/p", baseDigest: fingerprint(signed),
      ops: [{ op: "status", id: "I-002", from: "todo", to: "done" }],
    }, TODAY);
    expect(r.ok, r.reason).toBe(true);
  });

  // ── 三种签不了的情况 ───────────────────────────────────────────────────
  it("验证不是人工检查的，签不了", () => {
    const r = applyChanges(yaml, envelope([
      { op: "sign", id: "I-001", who: "人", words: "我说它行" },
    ]), TODAY);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/人工|manual/);
  });

  it("话是空的，签不了 —— 空白签名等于没签", () => {
    for (const words of ["", "   ", "\n"]) {
      const r = applyChanges(yaml, envelope([{ op: "sign", id: "I-002", who: "人", words }]), TODAY);
      expect(r.ok, `words=${JSON.stringify(words)} 竟然签上了`).toBe(false);
      expect(r.reason).toMatch(/原话|话/);
    }
  });

  it("已经签过的，不覆盖 —— 谁能推翻别人的签字是另一件要先想清楚的事", () => {
    const r = applyChanges(yaml, envelope([
      { op: "sign", id: "I-003", who: "另一个人", words: "我不同意" },
    ]), TODAY);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/已经签|签过/);
    expect(r.text).toBeUndefined();
  });

  it("名字空着也签不了 —— 一条查不到是谁签的记录没有意义", () => {
    const r = applyChanges(yaml, envelope([{ op: "sign", id: "I-002", who: "  ", words: "验过了" }]), TODAY);
    expect(r.ok).toBe(false);
  });
});

// ── 网页这半 ─────────────────────────────────────────────────────────────

function editingModule(html: string): string {
  const blocks = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  return blocks.find((b) => b.includes("createLedger"))!;
}

function openPage() {
  const html = render(graphOf(), yaml, "D:/p");
  const window = new Window({ url: "file:///D:/p/ideas/graph.html" });
  const document = window.document;
  document.write("<!doctype html><html><body></body></html>");
  document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>"));
  for (const id of ["mermaid-source-fn", "ledger-fn"]) {
    (window as any).eval(document.getElementById(id)!.textContent);
  }
  (window as any).eval(editingModule(html));
  return { window, document };
}

const ops = (window: any) => {
  const raw = window.localStorage.getItem(window.document.getElementById("graph-data").dataset.draftKey);
  return raw ? JSON.parse(raw).ops : [];
};

describe("I-081 网页签字 —— 页面这半", () => {
  it("只有「人工验证且还没签字」的卡片才有签字入口", () => {
    const { document } = openPage();
    expect(document.querySelector('[data-sign="I-002"]'), "该有签字入口的没有").toBeTruthy();
    expect(document.querySelector('[data-sign="I-001"]'), "机器能验的不该有").toBeFalsy();
    expect(document.querySelector('[data-sign="I-003"]'), "已经签过的不该有").toBeFalsy();
  });

  // 这一条是整个想法的重点：你在为一件具体的事签字，不是签一张空白纸。
  it("点开签字，先看得见那条人工检查的原文", () => {
    const { document } = openPage();
    document.querySelector('[data-sign="I-002"]').click();
    const box = document.getElementById("sign-panel");
    expect(box, "没有签字面板").toBeTruthy();
    expect(box.textContent, "签字面板里没写清楚在签什么")
      .toContain("在一台没装过的机器上走一遍");
  });

  it("填上名字和话，提交之后账本里就有一条签字操作", () => {
    const { window, document } = openPage();
    document.querySelector('[data-sign="I-002"]').click();
    const who = document.getElementById("sign-who");
    const words = document.getElementById("sign-words");
    who.value = "Zijia Tang";
    words.value = "装过了，hook 真的拦得住";
    document.getElementById("sign-go").click();

    expect(ops(window)).toEqual([
      { op: "sign", id: "I-002", who: "Zijia Tang", words: "装过了，hook 真的拦得住" },
    ]);
  });

  it("话没填就点，不记账 —— 页面这一层也不放空白签名过去", () => {
    const { window, document } = openPage();
    document.querySelector('[data-sign="I-002"]').click();
    document.getElementById("sign-who").value = "Zijia Tang";
    document.getElementById("sign-go").click();
    expect(ops(window)).toEqual([]);
  });

  // 名字存进浏览器本地存储，下次点开就已经填好了。
  // 这里在同一个窗口里验「写进去 → 再读出来」：openPage 每次都新建一个 happy-dom
  // 窗口，两个窗口的存储互不相通，跨页面那种写法根本测不到这件事。
  it("名字记在浏览器里，再点开签字时已经填好了", () => {
    const { document } = openPage();
    document.querySelector('[data-sign="I-002"]').click();
    document.getElementById("sign-who").value = "Zijia Tang";
    document.getElementById("sign-words").value = "验过了";
    document.getElementById("sign-go").click();

    document.querySelector('[data-sign="I-002"]').click();   // 再点开一次
    expect(document.getElementById("sign-who").value).toBe("Zijia Tang");
    expect(document.getElementById("sign-words").value, "话不该被记住 —— 每次签的是不同的事").toBe("");
  });
});
