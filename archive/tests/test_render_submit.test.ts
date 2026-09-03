import { describe, it, expect } from "vitest";
import { Window } from "happy-dom";
import { parse } from "yaml";
import { render, type Graph } from "../../claude-companion/ideas.js";

// I-064 — 网页上的「提交」：有本地服务器就直接存盘，没有就下载成一个改动文件。
//
// 两条路送出去的是同一个信封。这份测试把页面装进真 DOM、真去点提交，
// 然后看它到底发了什么请求、或者到底产出了什么文件。
//
// 探测服务器这一步不能让页面卡住或弹错，所以「探测失败」也要有测试 ——
// 直接双击打开的那一份走的正是这条路。

const yaml = `version: 1
agent: claude
project: fixture
endpoints: [I-002]
ideas:
  - id: I-001
    name: "地基"
    status: todo
    needs: []
    what: W1
  - id: I-002
    name: "终点：做完了"
    status: todo
    needs: [I-001]
    what: W2
`;

const PROJECT = "D:/GitHub/my-project";
const TOKEN = "abcdef0123456789abcdef0123456789";
const graphOf = () => parse(yaml) as Graph;

function editingModule(html: string): string {
  const blocks = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const found = blocks.find((b) => b.includes("createLedger"));
  expect(found, "页面里没有接账本的编辑模块").toBeTruthy();
  return found!;
}

interface Call { url: string; body: any }

/**
 * Load the page. `server` false means no local service — the health probe
 * fails, which is exactly what a double-clicked file sees.
 */
function openPage({ server = true, reply = { ok: true, preview: true, changed: ["I-001 · what"] } as any } = {}) {
  const html = render(graphOf(), yaml, PROJECT, server ? TOKEN : "");
  const window = new Window({ url: server ? "http://127.0.0.1:8787/" : "file:///D:/p/ideas/graph.html" });
  const document = window.document;
  document.write("<!doctype html><html><body></body></html>");
  document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>"));

  const calls: Call[] = [];
  const downloads: { name: string; text: string }[] = [];
  let reloaded = false;

  (window as any).fetch = async (url: string, init?: any) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    if (String(url).includes("/health")) {
      if (!server) throw new Error("connection refused");
      return { ok: true, json: async () => ({ ok: true }) };
    }
    const answer = body?.confirm ? { ok: true, changed: reply.changed } : reply;
    return { ok: true, json: async () => answer };
  };
  // Catch the download without a real browser: remember what the page tried
  // to hand over instead of letting it navigate.
  (window as any).URL.createObjectURL = (blob: any) => {
    downloads.push({ name: "", text: blob?.__text ?? "" });
    return "blob:fake";
  };
  (window as any).URL.revokeObjectURL = () => {};
  const RealBlob = (window as any).Blob;
  (window as any).Blob = class extends RealBlob {
    __text: string;
    constructor(parts: any[], opts: any) { super(parts, opts); this.__text = String(parts[0]); }
  };
  (window as any).AbortSignal = { timeout: () => undefined };
  Object.defineProperty(window.location, "reload", { value: () => { reloaded = true; }, writable: true });

  for (const id of ["mermaid-source-fn", "ledger-fn"]) {
    (window as any).eval(document.getElementById(id)!.textContent);
  }
  (window as any).eval(editingModule(html));
  return { window, document, calls, downloads, reloaded: () => reloaded, html };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const edit = (window: any, document: any, id: string, field: string, value: string) => {
  const el = document.querySelector(`[data-idea="${id}"][data-field="${field}"]`);
  el.value = value;
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
};

describe("I-064 网页上的提交", () => {
  it("页面上有一个提交按钮", () => {
    const { document } = openPage();
    expect(document.getElementById("submit")).toBeTruthy();
  });

  it("什么都没改的时候，提交按钮不能点", () => {
    const { document } = openPage();
    expect(document.getElementById("submit").disabled).toBe(true);
  });

  it("改了东西之后，提交按钮可以点了", () => {
    const { window, document } = openPage();
    edit(window, document, "I-001", "what", "改过的");
    expect(document.getElementById("submit").disabled).toBe(false);
  });

  // ── 有服务器：两步 ─────────────────────────────────────────────────────
  it("有服务器时，第一次点提交只是预览：带令牌、confirm 是 false", async () => {
    const { window, document, calls } = openPage();
    edit(window, document, "I-001", "what", "改过的");
    document.getElementById("submit").click();
    await tick(); await tick(); await tick();

    const post = calls.find((c) => c.url.includes("/changes"));
    expect(post, "没有把改动发给服务器").toBeTruthy();
    expect(post!.body.token).toBe(TOKEN);
    expect(post!.body.confirm).toBe(false);
    expect(post!.body.envelope.ops).toHaveLength(1);
    expect(post!.body.envelope.baseDigest, "指纹必须原样带回").toBe(
      document.getElementById("graph-data").dataset.fingerprint);
  });

  it("预览回来之后，页面把逐条改动列给人看，等确认", async () => {
    const { window, document } = openPage();
    edit(window, document, "I-001", "what", "改过的");
    document.getElementById("submit").click();
    await tick(); await tick(); await tick();
    expect(document.body.textContent).toContain("I-001 · what");
    expect(document.getElementById("confirm-write"), "没有让人确认的按钮").toBeTruthy();
  });

  it("人点确认之后才真的写，这一次 confirm 是 true", async () => {
    const { window, document, calls } = openPage();
    edit(window, document, "I-001", "what", "改过的");
    document.getElementById("submit").click();
    await tick(); await tick(); await tick();
    document.getElementById("confirm-write").click();
    await tick(); await tick(); await tick();

    const writes = calls.filter((c) => c.url.includes("/changes") && c.body.confirm === true);
    expect(writes).toHaveLength(1);
    expect(writes[0].body.token).toBe(TOKEN);
  });

  it("服务器拒绝时，把理由显示出来，账本不清空", async () => {
    const { window, document } = openPage({ reply: { ok: false, reason: "想法图在这份改动写成之后被改过了" } });
    edit(window, document, "I-001", "what", "改过的");
    document.getElementById("submit").click();
    await tick(); await tick(); await tick();
    expect(document.body.textContent).toContain("被改过了");
    expect(document.getElementById("draft-count").textContent, "改动被清掉了").toBe("1");
  });

  // ── 没有服务器：降级 ───────────────────────────────────────────────────
  // 直接双击打开的那一份走的就是这条。探测必须安静地失败。
  it("探测不到服务器时不报错，改成产出一个改动文件", async () => {
    const { window, document, downloads, calls } = openPage({ server: false });
    edit(window, document, "I-001", "what", "改过的");
    expect(() => document.getElementById("submit").click()).not.toThrow();
    await tick(); await tick(); await tick();

    expect(calls.some((c) => c.url.includes("/changes")), "没有服务器却还是发了请求").toBe(false);
    expect(downloads).toHaveLength(1);
    const env = JSON.parse(downloads[0].text);
    expect(env.v).toBe(1);
    expect(env.ops).toHaveLength(1);
    expect(env.baseDigest).toBe(document.getElementById("graph-data").dataset.fingerprint);
  });

  it("降级的时候，页面写清楚把文件放到哪、然后跑哪条命令", async () => {
    const { window, document } = openPage({ server: false });
    edit(window, document, "I-001", "what", "改过的");
    document.getElementById("submit").click();
    await tick(); await tick(); await tick();
    const text = document.body.textContent;
    expect(text, "没告诉人放到哪个目录").toContain(PROJECT);
    expect(text, "没告诉人跑哪条命令").toContain("apply");
  });

  // 兜底那一级唯一的要求就是不会失败：下载会被拦、剪贴板在 file:// 下常常用不了，
  // 而一个能全选的文本框在任何浏览器里都不会失败。
  it("兜底给一个能全选复制的文本框，里面就是改动文件的内容", async () => {
    const { window, document } = openPage({ server: false });
    edit(window, document, "I-001", "what", "改过的");
    document.getElementById("submit").click();
    await tick(); await tick(); await tick();
    const box = document.getElementById("submit-text");
    expect(box, "没有兜底的文本框").toBeTruthy();
    expect(JSON.parse(box.value).ops).toHaveLength(1);
  });

  // ── 草稿 ───────────────────────────────────────────────────────────────
  // 写回一旦被拒，人的改动不能一份都不剩。
  it("提交成功也不清草稿，只标成已提交", async () => {
    const { window, document } = openPage();
    edit(window, document, "I-001", "what", "改过的");
    const key = document.getElementById("graph-data").dataset.draftKey;
    document.getElementById("submit").click();
    await tick(); await tick(); await tick();
    document.getElementById("confirm-write").click();
    await tick(); await tick(); await tick();
    expect(window.localStorage.getItem(key), "草稿被清掉了").toBeTruthy();
    expect(document.body.textContent).toContain("已提交");
  });
});
