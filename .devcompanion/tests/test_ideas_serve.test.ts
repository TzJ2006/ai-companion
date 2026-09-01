import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { serve, browserCommand, fingerprint, type Serving } from "../../claude-companion/ideas.js";

// I-079 — 本地小服务：当场把想法图渲染给浏览器，并接住浏览器发回来的改动。
//
// 这份测试真的起服务、真的发请求。要盯住的是三件事：
// 它只绑本机（不是绑到所有网卡上）、写操作必须带对本次启动的令牌、
// 以及落盘走的是和命令行完全相同的那套校验 —— 两个写入口意味着两套校验，
// 迟早分叉，而分叉的那天是「网页存进去的图和命令行存进去的图不一样」。

const yaml = `version: 1
agent: claude
project: fixture
endpoints: [ I-002 ]

ideas:

  - id: I-001
    name: "地基"
    status: todo
    needs: []
    what: >
      W1

  - id: I-002
    name: "终点：做完了"
    status: todo
    needs: [ I-001 ]
    what: >
      W2
`;

let dir: string;
let file: string;
let live: Serving | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "serve-"));
  mkdirSync(join(dir, "ideas"), { recursive: true });
  file = join(dir, "ideas", "graph.yaml");
  writeFileSync(file, yaml);
});
afterEach(async () => { await live?.close(); live = undefined; });

const start = async (port?: number) => {
  live = await serve(dir, file, { port, open: false });
  return live;
};

const graphNow = () => readFileSync(file, "utf8");

/** Post an envelope the way the page would. */
const post = (s: Serving, body: unknown) =>
  fetch(s.url + "/changes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const envelopeNow = (ops: unknown[]) =>
  ({ v: 1, project: dir, baseDigest: fingerprint(graphNow()), ops });

describe("I-079 本地小服务", () => {
  // ── 只绑本机 ───────────────────────────────────────────────────────────
  // 绑到所有网卡上，同一个网络里的任何人都能改这个仓库的想法图。
  it("只监听本机回环地址，不是所有网卡", async () => {
    const s = await start();
    expect(s.host).toBe("127.0.0.1");
    expect(s.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("端口被占用就往上加一，并把最终地址报出来", async () => {
    const squatter = createServer(() => {});
    await new Promise<void>((r) => squatter.listen(0, "127.0.0.1", r));
    const taken = (squatter.address() as { port: number }).port;
    try {
      const s = await start(taken);
      expect(s.port).toBeGreaterThan(taken);
    } finally {
      await new Promise<void>((r) => squatter.close(() => r()));
    }
  });

  // ── 三条路径 ───────────────────────────────────────────────────────────
  it("健康检查能通 —— 页面靠它判断有没有服务", async () => {
    const s = await start();
    const r = await fetch(s.url + "/health");
    expect(r.status).toBe(200);
    expect((await r.json()).ok).toBe(true);
  });

  it("首页是当场渲染出来的，不是磁盘上那份可能过期的网页", async () => {
    const s = await start();
    const html = await (await fetch(s.url)).text();
    expect(html).toContain("终点：做完了");
    // 改一下磁盘上的图，重新请求应该看到新的 —— 当场渲染的意思就是这个。
    writeFileSync(file, graphNow().replace("终点：做完了", "改过的终点"));
    expect(await (await fetch(s.url)).text()).toContain("改过的终点");
  });

  it("页面里带着本次启动生成的令牌", async () => {
    const s = await start();
    const html = await (await fetch(s.url)).text();
    expect(s.token.length).toBeGreaterThan(15);
    expect(html).toContain(s.token);
  });

  // ── 令牌 ───────────────────────────────────────────────────────────────
  it("写操作不带令牌，拒绝，图一个字不动", async () => {
    const s = await start();
    const before = graphNow();
    const r = await post(s, { envelope: envelopeNow([]), confirm: true });
    expect(r.status).toBe(403);
    expect(graphNow()).toBe(before);
  });

  it("令牌不对，拒绝", async () => {
    const s = await start();
    const r = await post(s, { token: "假的令牌", envelope: envelopeNow([]), confirm: true });
    expect(r.status).toBe(403);
  });

  // ── 两步：先看，再落盘 ─────────────────────────────────────────────────
  it("第一步只算不写：回一份逐条对照，磁盘上的图不变", async () => {
    const s = await start();
    const before = graphNow();
    const r = await post(s, {
      token: s.token, confirm: false,
      envelope: envelopeNow([{ op: "set", id: "I-001", field: "what", old: "W1", new: "改过的说明" }]),
    });
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.changed.join(" ")).toContain("I-001");
    expect(graphNow(), "预览这一步不该写盘").toBe(before);
  });

  it("人确认之后才真的写，写完图里就是新内容", async () => {
    const s = await start();
    const r = await post(s, {
      token: s.token, confirm: true,
      envelope: envelopeNow([{ op: "set", id: "I-001", field: "what", old: "W1", new: "确认之后写进去的" }]),
    });
    expect((await r.json()).ok).toBe(true);
    expect(graphNow()).toContain("确认之后写进去的");
    expect(graphNow(), "注释和别处没被搅乱").toContain('name: "终点：做完了"');
  });

  it("写完之后回给页面的是新图，页面据此重画", async () => {
    const s = await start();
    const r = await post(s, {
      token: s.token, confirm: true,
      // 新建一个想法并连上去 —— 反着连 I-001 needs I-002 会成环，check 会拒。
      envelope: envelopeNow([
        { op: "add", tmp: "tmp:1", fields: { name: "新的", what: "W", why: "Y", expected: "E" } },
        { op: "link", from: "I-002", to: "tmp:1" },
      ]),
    });
    const body = await r.json();
    expect(body.ok, body.reason).toBe(true);
    const fresh = body.graph.ideas.find((i: { name: string }) => i.name === "新的");
    expect(fresh.id).toBe("I-003");
    expect(fresh.needs).toEqual(["I-002"]);
  });

  // ── 落盘走的是同一套校验 ───────────────────────────────────────────────
  it("指纹对不上，整体拒绝，图不动", async () => {
    const s = await start();
    const before = graphNow();
    const r = await post(s, {
      token: s.token, confirm: true,
      envelope: { v: 1, project: dir, baseDigest: "000000000000", ops: [] },
    });
    const body = await r.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toMatch(/指纹|改过/);
    expect(graphNow()).toBe(before);
  });

  it("会把图写坏的改动被拒，磁盘不动", async () => {
    const s = await start();
    const before = graphNow();
    const r = await post(s, {
      token: s.token, confirm: true,
      envelope: envelopeNow([{ op: "remove", id: "I-001" }]),   // I-002 还依赖着它
    });
    expect((await r.json()).ok).toBe(false);
    expect(graphNow()).toBe(before);
  });

  it("版本号不认识，拒绝", async () => {
    const s = await start();
    const r = await post(s, {
      token: s.token, confirm: true,
      envelope: { v: 99, project: dir, baseDigest: fingerprint(graphNow()), ops: [] },
    });
    const body = await r.json();
    expect(body.ok).toBe(false);
    expect(body.reason).toMatch(/版本/);
  });

  // ── 默认那条路 ─────────────────────────────────────────────────────────
  // 上面每一条测试都传了 open:false，于是「开浏览器」那段代码一次都没跑过 ——
  // 而 npm run graph 走的正是默认的 open:true。第一版就栽在这里：那段代码用了
  // 一个没被 import 进来的名字，服务直接起不来，报「platform is not defined」，
  // 而 14 条测试全绿。人实际用的那条路，恰恰是唯一没被测过的。
  it("算得出在这个平台上用什么命令开浏览器", () => {
    const [cmd, args] = browserCommand("http://127.0.0.1:1/");
    expect(cmd.length).toBeGreaterThan(0);
    expect(args.join(" ")).toContain("http://127.0.0.1:1/");
  });

  it("按默认参数起服务（就是 npm run graph 那条路），服务照样活着", async () => {
    process.env.AIDEV_NO_BROWSER = "1";      // 测试里别真弹一个浏览器窗口出来
    try {
      const s = await serve(dir, file, {});  // 不传 open —— 默认是 true
      live = s;
      expect((await (await fetch(s.url + "/health")).json()).ok).toBe(true);
    } finally { delete process.env.AIDEV_NO_BROWSER; }
  });

  // 双击入口唯一的工作就是把这个服务起起来，所以它的回归断言放在这里。
  // cmd.exe 读 .cmd 文件用的是系统 OEM 代码页而不是 UTF-8：里面只要有一个
  // 非 ASCII 字符，行就会被按错误编码拆坏，注释的一部分会被当成命令去执行
  // （实测报错 'e-companion' is not recognized as an internal or external command）。
  // 这条断言比人去双击一次更早、更稳地抓住这类问题。
  it("Windows 的双击入口必须是纯 ASCII，否则 cmd 会把它读坏", () => {
    const bat = readFileSync(join(process.cwd(), "graph.cmd"), "utf8");
    const bad = [...bat].filter((c) => c.codePointAt(0)! > 127);
    expect(bad, `graph.cmd 里有非 ASCII 字符：${bad.join(" ")}`).toEqual([]);
    expect(bat).toContain('cd /d "%~dp0"');   // 少了它，从别处双击会跑错目录
    expect(bat).toContain("serve");
  });

  it("关掉之后端口就不再应答了", async () => {
    const s = await start();
    const url = s.url;
    await s.close();
    live = undefined;
    await expect(fetch(url + "/health")).rejects.toThrow();
  });
});
