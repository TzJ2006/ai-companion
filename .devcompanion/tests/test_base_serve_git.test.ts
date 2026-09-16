import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { serve, graphPath, type Serving } from "../../companion/ideas.js";

// I-137 — 本地小服务接上 git：开关打开时，渲染前 git pull --ff-only，写回成功后
// add/commit/push；拉取失败印在页面上（503）；开关关着一个 git 命令都不跑。
// 后台契约：--port、--no-open 已有，标准输出第一行是「想法图开在 http://127.0.0.1:端口」。
describe("serve --git-sync (I-137)", () => {
  const dirs: string[] = [];
  const ENGINE = resolve(fileURLToPath(import.meta.url), "../../../companion/ideas.ts");
  const PORT_BASE = 4300 + Math.floor(Math.random() * 3000);

  const yaml = `version: 1
project: fixture
endpoints: [I-001]
ideas:
  - id: I-001
    name: "一个想法"
    status: todo
    needs: []
    what: 原来的说法
    why: Y1
    expected: E1
    how: H1
    why_this_way: T1
    future: F1
    code:
      - file: src/x.ts
    verify: { command: "npx vitest run tests/x.test.ts", test_files: [ tests/x.test.ts ], pass: "exit 0" }
`;

  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} 失败：${r.stderr}`);
    return r.stdout.trim();
  };

  /** A bare remote plus two clones; clone A already holds the fixture graph on main. */
  function twoClones() {
    const root = mkdtempSync(join(tmpdir(), "servegit-"));
    dirs.push(root);
    const remote = join(root, "remote.git");
    git(root, "init", "--bare", "-b", "main", remote);
    const a = join(root, "A"), b = join(root, "B");
    git(root, "clone", "-q", remote, a);
    for (const d of [a]) {
      git(d, "config", "user.email", "t@example.com");
      git(d, "config", "user.name", "tester");
    }
    mkdirSync(join(a, "ideas"), { recursive: true });
    writeFileSync(graphPath(a), yaml);
    git(a, "add", "ideas/graph.yaml");
    git(a, "commit", "-q", "-m", "seed");
    git(a, "push", "-q", "-u", "origin", "main");
    git(root, "clone", "-q", remote, b);
    git(b, "config", "user.email", "t@example.com");
    git(b, "config", "user.name", "tester");
    return { root, remote, a, b };
  }

  async function page(live: Serving) {
    const res = await fetch(live.url + "/");
    const html = await res.text();
    const token = /data-token="([^"]+)"/.exec(html)?.[1] ?? "";
    const digest = /data-fingerprint="([^"]+)"/.exec(html)?.[1] ?? "";
    return { status: res.status, html, token, digest };
  }

  async function edit(live: Serving, projectDir: string, newWhat: string) {
    const p = await page(live);
    const envelope = {
      v: 1, project: projectDir, baseDigest: p.digest,
      ops: [{ op: "set", id: "I-001", field: "what", old: "原来的说法", new: newWhat }],
    };
    const res = await fetch(live.url + "/changes", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: p.token, envelope, confirm: true }),
    });
    return (await res.json()) as { ok: boolean; reason?: string; git?: string };
  }

  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  it("写回之后提交并推送，另一处检出 pull 就拿到", { timeout: 60_000 }, async () => {
    const { a, b } = twoClones();
    const live = await serve(a, graphPath(a), { port: PORT_BASE, open: false, gitSync: true });
    try {
      const r = await edit(live, a, "改过了");
      expect(r.ok).toBe(true);
      expect(readFileSync(graphPath(a), "utf8")).toContain("改过了");
      expect(git(a, "log", "-1", "--format=%s")).toMatch(/网页写回 1 处/);
      expect(git(a, "status", "--porcelain")).toBe("");            // nothing left uncommitted
      git(b, "pull", "-q");
      expect(readFileSync(graphPath(b), "utf8")).toContain("改过了");
    } finally { await live.close(); }
  });

  it("开关关着：写回落盘，但一个 git 命令都不跑", { timeout: 60_000 }, async () => {
    const { a } = twoClones();
    const before = git(a, "rev-parse", "HEAD");
    const live = await serve(a, graphPath(a), { port: PORT_BASE + 10, open: false });
    try {
      const r = await edit(live, a, "改过了");
      expect(r.ok).toBe(true);
      expect(git(a, "rev-parse", "HEAD")).toBe(before);
      expect(git(a, "status", "--porcelain")).toMatch(/ideas\/graph\.yaml/);   // dirty, uncommitted
    } finally { await live.close(); }
  });

  it("拉取失败不吞掉：页面回 503，正文是 git 的错误", { timeout: 60_000 }, async () => {
    const { a, b } = twoClones();
    // B moves the graph on the remote; A has an uncommitted edit to the same file,
    // so `git pull --ff-only` refuses to overwrite it.
    writeFileSync(graphPath(b), yaml.replace("原来的说法", "B 改的"));
    git(b, "commit", "-q", "-am", "b edit");
    git(b, "push", "-q");
    writeFileSync(graphPath(a), yaml.replace("原来的说法", "A 没提交的"));
    const live = await serve(a, graphPath(a), { port: PORT_BASE + 20, open: false, gitSync: true });
    try {
      const res = await fetch(live.url + "/");
      expect(res.status).toBe(503);
      const body = await res.text();
      expect(body).toMatch(/git pull/);
      expect(body).toMatch(/overwritten|would be overwritten|冲突|refus/i);
    } finally { await live.close(); }
  });

  it("后台契约：标准输出第一行是「想法图开在 http://127.0.0.1:端口」", { timeout: 90_000 }, async () => {
    const { a } = twoClones();
    const port = PORT_BASE + 30;
    const child = spawn("npx", ["tsx", ENGINE, "serve", "--no-open", "--port", String(port), "--project", a],
      { shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const first = await new Promise<string>((done, fail) => {
      const timer = setTimeout(() => fail(new Error(`serve 没有在时限内开口：${out}`)), 80_000);
      child.stdout.on("data", (c) => {
        out += String(c);
        const nl = out.indexOf("\n");
        if (nl >= 0) { clearTimeout(timer); done(out.slice(0, nl).replace(/\r$/, "")); }
      });
      child.on("exit", (code) => { clearTimeout(timer); fail(new Error(`serve 提前退出 ${code}：${out}`)); });
    }).finally(() => {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
      else child.kill();
    });
    expect(first).toMatch(/^想法图开在 http:\/\/127\.0\.0\.1:\d+$/);
  });
});
