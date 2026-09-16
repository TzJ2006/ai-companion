import { describe, it, expect, afterAll, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { serve, graphPath, paths, load, requestApproval, validApproval, type Serving } from "../../companion/ideas.js";

// I-139 —— 网页批准落地：serve 多一个 POST /approve，只在环境变量 AIDEV_APPROVE_SECRET 设了才开；
// 凭证对了就把人的那句原话交给 applyApproval（和终端同一条校验），回执落进 ideas/approvals/receipts/；
// 凭证不对 403，没设变量 404；凭证不出现在页面和标准输出里（D36 带外例外的第一条）。
describe("serve POST /approve (I-139)", () => {
  const dirs: string[] = [];
  const ENGINE = resolve(fileURLToPath(import.meta.url), "../../../companion/ideas.ts");
  const PORT_BASE = 4700 + Math.floor(Math.random() * 3000);
  const SECRET = "s3cret-" + Math.random().toString(16).slice(2);
  const saved = process.env.AIDEV_APPROVE_SECRET;

  const yaml = `version: 1
project: fixture
endpoints: [I-002]
ideas:
  - id: I-001
    name: "要人亲眼验收的想法"
    status: todo
    needs: []
    what: W1
    why: Y1
    expected: E1
    how: H1
    why_this_way: T1
    future: F1
    code:
      - file: src/base.ts
    verify: { manual: "打开页面亲眼看一遍", signed_off: null }
  - id: I-002
    name: "自动验证的想法"
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
    verify: { command: "npx vitest run tests/mid.test.ts", test_files: [ tests/mid.test.ts ], pass: "exit 0" }
`;

  const project = () => {
    const dir = mkdtempSync(join(tmpdir(), "appv-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    writeFileSync(graphPath(dir), yaml);
    return dir;
  };
  const graphOf = (dir: string) => load(graphPath(dir)).graph;
  const post = async (live: Serving, body: unknown) => {
    const res = await fetch(live.url + "/approve", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as { ok: boolean; reason?: string } };
  };
  const receipt = (dir: string, cc: string) => join(paths(dir).approvals, "receipts", `${cc}.json`);

  afterEach(() => {
    if (saved === undefined) delete process.env.AIDEV_APPROVE_SECRET; else process.env.AIDEV_APPROVE_SECRET = saved;
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  it("环境变量没设：入口不存在（404），和今天一样", async () => {
    delete process.env.AIDEV_APPROVE_SECRET;
    const dir = project();
    const live = await serve(dir, graphPath(dir), { port: PORT_BASE, open: false });
    try {
      const r = await post(live, { secret: "anything", words: "批准 CC-00000000" });
      expect(r.status).toBe(404);
    } finally { await live.close(); }
  });

  it("凭证对：回执落盘、set doing 的门认它；同一口令第二次被拒", async () => {
    process.env.AIDEV_APPROVE_SECRET = SECRET;
    const dir = project();
    const { challenge } = requestApproval(dir, graphOf(dir), "plan", ["I-002"]);
    const live = await serve(dir, graphPath(dir), { port: PORT_BASE + 10, open: false });
    try {
      const first = await post(live, { secret: SECRET, words: `批准 ${challenge}` });
      expect(first.status).toBe(200);
      expect(first.json.ok).toBe(true);
      expect(existsSync(receipt(dir, challenge))).toBe(true);
      expect(validApproval(dir, graphOf(dir), "plan", "I-002")).toBe(true);
      const again = JSON.parse(readFileSync(receipt(dir, challenge), "utf8"));
      expect(again.session_id).toBe("serve");            // provenance says it came in over the entry

      const second = await post(live, { secret: SECRET, words: `批准 ${challenge}` });
      expect(second.json.ok).toBe(false);
      expect(second.json.reason).toMatch(/已用|不存在/);
    } finally { await live.close(); }
  });

  it("凭证错或没带：403，不留回执；口令包在话里也不算", async () => {
    process.env.AIDEV_APPROVE_SECRET = SECRET;
    const dir = project();
    const { challenge } = requestApproval(dir, graphOf(dir), "plan", ["I-002"]);
    const live = await serve(dir, graphPath(dir), { port: PORT_BASE + 20, open: false });
    try {
      expect((await post(live, { secret: "wrong", words: `批准 ${challenge}` })).status).toBe(403);
      expect((await post(live, { words: `批准 ${challenge}` })).status).toBe(403);
      expect(existsSync(receipt(dir, challenge))).toBe(false);
      const prose = await post(live, { secret: SECRET, words: `我觉得行，批准 ${challenge} 吧` });
      expect(prose.json.ok).toBe(false);
      expect(existsSync(receipt(dir, challenge))).toBe(false);
      expect(existsSync(join(paths(dir).approvals, "pending", `${challenge}.json`))).toBe(true); // untouched
    } finally { await live.close(); }
  });

  it("内容改过之后再回：拒绝，口令作废，不留回执", async () => {
    process.env.AIDEV_APPROVE_SECRET = SECRET;
    const dir = project();
    const { challenge } = requestApproval(dir, graphOf(dir), "plan", ["I-002"]);
    writeFileSync(graphPath(dir), yaml.replace("how: H2", "how: H2改"));
    const live = await serve(dir, graphPath(dir), { port: PORT_BASE + 30, open: false });
    try {
      const r = await post(live, { secret: SECRET, words: `批准 ${challenge}` });
      expect(r.json.ok).toBe(false);
      expect(existsSync(receipt(dir, challenge))).toBe(false);
    } finally { await live.close(); }
  });

  it("凭证不进页面源码，也不进响应", async () => {
    process.env.AIDEV_APPROVE_SECRET = SECRET;
    const dir = project();
    const live = await serve(dir, graphPath(dir), { port: PORT_BASE + 40, open: false });
    try {
      const html = await (await fetch(live.url + "/")).text();
      expect(html).not.toContain(SECRET);
      const r = await post(live, { secret: "wrong", words: "批准 CC-00000000" });
      expect(JSON.stringify(r.json)).not.toContain(SECRET);
    } finally { await live.close(); }
  });

  it("git 同步开着：回执随即提交", async () => {
    process.env.AIDEV_APPROVE_SECRET = SECRET;
    const root = mkdtempSync(join(tmpdir(), "appvgit-"));
    dirs.push(root);
    const git = (cwd: string, ...args: string[]) => {
      const r = spawnSync("git", args, { cwd, encoding: "utf8" });
      if (r.status !== 0) throw new Error(`git ${args.join(" ")} 失败：${r.stderr}`);
      return r.stdout.trim();
    };
    const remote = join(root, "remote.git"), a = join(root, "A");
    git(root, "init", "--bare", "-b", "main", remote);
    git(root, "clone", "-q", remote, a);
    git(a, "config", "user.email", "t@example.com");
    git(a, "config", "user.name", "tester");
    mkdirSync(join(a, "ideas"), { recursive: true });
    writeFileSync(graphPath(a), yaml);
    const { challenge } = requestApproval(a, graphOf(a), "plan", ["I-002"]);
    git(a, "add", "-A");
    git(a, "commit", "-q", "-m", "seed with pending challenge");
    git(a, "push", "-q", "-u", "origin", "main");
    const live = await serve(a, graphPath(a), { port: PORT_BASE + 50, open: false, gitSync: true });
    try {
      expect((await post(live, { secret: SECRET, words: `批准 ${challenge}` })).json.ok).toBe(true);
      expect(git(a, "status", "--porcelain")).toBe("");
      expect(git(a, "log", "-1", "--format=%s")).toMatch(/批准/);
    } finally { await live.close(); }
  });

  it("标准输出：第一行还是地址，第二行说入口已开，凭证本身不打印", { timeout: 90_000 }, async () => {
    const dir = project();
    const child = spawn("npx", ["tsx", ENGINE, "serve", "--no-open", "--port", String(PORT_BASE + 60), "--project", dir],
      { shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, AIDEV_APPROVE_SECRET: SECRET } });
    let out = "";
    const lines = await new Promise<string[]>((done, fail) => {
      const timer = setTimeout(() => fail(new Error(`serve 没有在时限内开口：${out}`)), 80_000);
      child.stdout.on("data", (c) => {
        out += String(c);
        const ls = out.split(/\r?\n/);
        if (ls.length >= 3) { clearTimeout(timer); done(ls); }
      });
      child.on("exit", (code) => { clearTimeout(timer); fail(new Error(`serve 提前退出 ${code}：${out}`)); });
    }).finally(() => {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
      else child.kill();
    });
    expect(lines[0]).toMatch(/^想法图开在 http:\/\/127\.0\.0\.1:\d+$/);
    expect(lines[1]).toMatch(/批准入口已开/);
    expect(out).not.toContain(SECRET);
  });
});
