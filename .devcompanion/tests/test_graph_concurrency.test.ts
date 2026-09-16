import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { main, mutateGraph, mutateGraphText, editIdeaField, applyChanges, load } from "../../companion/ideas.js";
import { withProjectLock } from "../../companion/coordination.js";

// I-116 —— 写图只有一个事务边界：拿短锁、读当前文件、改、原子写回、渲染、放锁。
// 之前 atomicWrite 只防「写出半个文件」，两个进程从同一份旧图出发各改各的，后写的
// 把先写的悄悄盖掉；网页也可能被一次较晚结束的旧渲染倒退。
//
// 为什么非要有这份测试：这里的失败方式全是「静默」—— 丢一个节点、少一条改动、HTML 比
// YAML 旧一版，没有任何报错。只有真并行地跑、再数结果，才知道边界守住了没有。

const REPO = resolve(fileURLToPath(import.meta.url), "../../..");
const ENGINE = join(REPO, "companion", "ideas.ts");
const TSX = join(REPO, "node_modules", "tsx", "dist", "cli.mjs");

const yaml = `version: 1
project: fixture
endpoints: [I-002]
next_id: 3
ideas:
  - id: I-001
    name: "地基"
    status: todo
    needs: []
    what: 地基是什么
    expected: 站得住
  - id: I-002
    name: "屋顶"
    status: todo
    needs: [I-001]
    parent: I-001
    what: 屋顶是什么
`;

describe("I-116 图事务：并行写不丢改动", () => {
  let dir: string;
  const dirs: string[] = [];
  const file = () => join(dir, "ideas", "graph.yaml");
  const graphNow = () => load(file()).graph;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "graph-tx-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    writeFileSync(file(), yaml);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  /** 真的另起一个进程跑引擎 —— 同一个进程里的两次调用不会互相竞争。 */
  const cli = (args: string[]) => new Promise<{ code: number; out: string }>((done) => {
    const child = spawn(process.execPath, [TSX, ENGINE, ...args, "--project", dir, "--date", "2026-09-16"],
      { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("close", (code) => done({ code: code ?? -1, out }));
  });

  it("六个进程同时 new：六个想法一个不少、编号不重、next_id 对得上", { timeout: 120_000 }, async () => {
    const results = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => cli(["new", `并行想法 ${n}`])));
    for (const r of results) expect(r.code, r.out).toBe(0);
    const g = graphNow();
    expect(g.ideas.length).toBe(8);
    const ids = g.ideas.map((i) => i.id);
    expect(new Set(ids).size).toBe(8);
    expect(g.next_id).toBe(9);
    // 六个名字都在，没有哪一个被后来的写盖掉。
    for (const n of [1, 2, 3, 4, 5, 6]) expect(g.ideas.some((i) => i.name === `并行想法 ${n}`), `并行想法 ${n} 丢了`).toBe(true);
  });

  it("两个 edit 改不同想法的不同字段：两处都保留", () => {
    mutateGraph(file(), dir, (d, g) => editIdeaField(d, g, dir, "I-001", "why", "因为要站住", undefined, { date: "2026-09-16" }));
    mutateGraph(file(), dir, (d, g) => editIdeaField(d, g, dir, "I-002", "why", "因为要遮雨", undefined, { date: "2026-09-16" }));
    const g = graphNow();
    expect(g.ideas[0].why).toBe("因为要站住");
    expect(g.ideas[1].why).toBe("因为要遮雨");
    expect(g.ideas[0].log?.at(-1)?.note).toMatch(/edit why/);
  });

  it("同一字段、同一个旧值、两个人先后提交：只有第一个成，第二个被明确拒绝", () => {
    const first = () => mutateGraph(file(), dir, (d, g) =>
      editIdeaField(d, g, dir, "I-001", "what", "地基是第一版", "地基是什么", { date: "2026-09-16" }));
    first();
    expect(() => mutateGraph(file(), dir, (d, g) =>
      editIdeaField(d, g, dir, "I-001", "what", "地基是第二版", "地基是什么", { date: "2026-09-16" }))).toThrow(/旧值不一样|改过了/);
    expect(graphNow().ideas[0].what).toBe("地基是第一版");
  });

  it("不合法的改动一个字都不落盘：未知字段、signed_off 越权、parent 成环、status", () => {
    const before = readFileSync(file(), "utf8");
    const attempt = (field: string, value: unknown) => () =>
      mutateGraph(file(), dir, (d, g) => editIdeaField(d, g, dir, "I-001", field, value, undefined, { date: "2026-09-16" }));
    expect(attempt("nonsense", "x")).toThrow(/只认/);
    expect(attempt("status", "done")).toThrow(/只认/);
    expect(attempt("verify", { manual: "看一眼", signed_off: "我自己签的" })).toThrow(/signed_off/);
    expect(attempt("parent", "I-002")).toThrow(/出错/);          // I-002 的 parent 是 I-001：成环
    expect(attempt("needs", ["I-999"])).toThrow(/出错/);         // 不存在的前置
    expect(readFileSync(file(), "utf8")).toBe(before);
  });

  it("命令行 edit 走同一条路：改了字段、记了修改记录、网页跟着重画", { timeout: 60_000 }, async () => {
    const r = await cli(["edit", "I-002", "--field", "expected", "--value-json", JSON.stringify("不漏雨"), "--old-json", "null"]);
    expect(r.code, r.out).toBe(0);
    expect(graphNow().ideas[1].expected).toBe("不漏雨");
    const html = readFileSync(join(dir, "ideas", "graph.html"), "utf8");
    expect(html).toContain("不漏雨");
  });

  it("apply 的 baseDigest 在提交那一刻比对：中间被别人改过就拒", () => {
    // 先按当前文件算一份信封，再让别的会话改一笔，再提交这份信封。
    const { digest } = fingerprint(readFileSync(file(), "utf8"));
    mutateGraph(file(), dir, (d, g) => editIdeaField(d, g, dir, "I-001", "why", "别人改的", undefined, { date: "2026-09-16" }));
    const m = mutateGraphText(file(), dir, (source) => applyEnvelope(source, digest));
    expect(m.result.ok).toBe(false);
    expect(String(m.result.reason)).toMatch(/改过|不是这张图|baseDigest|指纹/);
    expect(graphNow().ideas[0].why).toBe("别人改的");   // 别人的改动完好
  });

  it("锁被别人拿着：提交等一会儿，等不到就明说 busy，绝不硬写", () => {
    const runtime = join(dir, "ideas", ".runtime");
    expect(() => withProjectLock(runtime, () => {
      // 锁在手里时另一次提交（同进程模拟）必须等；这里超时设短，直接拿到 busy。
      return mutateGraphQuick(file(), dir);
    }, { timeoutMs: 100 })).toThrow(/busy|占用/);
  });

  it("渲染失败时 YAML 已提交，返回的是「图已保存，网页需重建」，不是整体失败", () => {
    mkdirSync(join(dir, "ideas", "graph.html"), { recursive: true });   // 目录占着网页的名字：写不进去
    const m = mutateGraph(file(), dir, (d, g) => editIdeaField(d, g, dir, "I-001", "why", "渲染坏了也要留下", undefined, { date: "2026-09-16" }));
    expect(m.rendered).toBeNull();
    expect(m.renderError).toMatch(/图已保存/);
    expect(graphNow().ideas[0].why).toBe("渲染坏了也要留下");
  });

  it("独立 render 也在锁里：跟一次提交串行，最后的网页和 YAML 一致", () => {
    mutateGraph(file(), dir, (d, g) => editIdeaField(d, g, dir, "I-002", "what", "最新的屋顶", undefined, { date: "2026-09-16" }));
    const lines: string[] = [];
    const log = console.log; console.log = (...a: unknown[]) => { lines.push(a.join(" ")); };
    try { expect(main(["render", "--project", dir])).toBe(0); } finally { console.log = log; }
    expect(readFileSync(join(dir, "ideas", "graph.html"), "utf8")).toContain("最新的屋顶");
  });

  // ── 小工具 ──────────────────────────────────────────────────────────────
  function fingerprint(source: string) {
    return { digest: createHash("sha256").update(source).digest("hex").slice(0, 12) };
  }
  function applyEnvelope(source: string, baseDigest: string) {
    return applyChanges(source, {
      v: 1, project: "fixture", baseDigest,
      ops: [{ op: "set", id: "I-002", field: "what", old: "屋顶是什么", new: "信封里的屋顶" }],
    }, "2026-09-16", dir);
  }
  function mutateGraphQuick(f: string, d: string) {
    // 一个「立刻超时」的提交：withProjectLock 的超时在 mutateGraph 里写死是 10 秒，
    // 这里用协调模块直接再拿一次锁来模拟等不到的情形。
    return withProjectLock(join(d, "ideas", ".runtime"), () => load(f).graph.ideas.length, { timeoutMs: 100 });
  }
  void existsSync;
});
