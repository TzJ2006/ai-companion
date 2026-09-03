import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SUBCOMMANDS, usageLines, skippedFiles, listProjectFiles } from "../../companion/ideas.js";

// H27 的引擎那一半：D28 承诺的 `log` 子命令、D28 那句「用法字符串不许再漂」、
// D29 的「跳过了哪些、各自为什么」、D30 的「所有生成状态原子写」。
// 之前的用法字符串是手抄的，已经漏掉了 migrate / run-check / request-approval ——
// 一条专门用来说明「有哪些命令」的消息，自己说漏了三条。
describe("companion CLI surface (H27 · D28/D29/D30)", () => {
  let dir: string;
  const dirs: string[] = [];
  const ENGINE = resolve(fileURLToPath(import.meta.url), "../../../companion/ideas.ts");
  const SOURCE = readFileSync(ENGINE, "utf8");

  const yaml = `version: 1
project: fixture
endpoints: [I-002]
ideas:
  - id: I-001
    name: "有记录的想法"
    status: todo
    needs: []
    what: W
    why: Y
    expected: E
    how: H
    why_this_way: T
    future: F
    log:
      - date: "2026-09-01"
        by: new
        note: 创建
      - date: "2026-09-02"
        by: think
        note: 想清楚了怎么做
  - id: I-002
    name: "没有记录的想法"
    status: todo
    needs: [I-001]
`;

  const run = (...args: string[]) =>
    spawnSync("npx", ["tsx", ENGINE, ...args, "--project", dir],
      { encoding: "utf8", shell: process.platform === "win32", timeout: 120_000 });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cli-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  // ── D28: one list, and the usage text is generated off it ─────────────────

  it("the usage text names every subcommand the CLI dispatches on", () => {
    // 真正的分发点：switch 的 case 标签，加上 switch 之前那几条 if。
    const cases = [...SOURCE.matchAll(/^\s*case "([a-z-]+)": \{/gm)].map((m) => m[1]);
    const earlies = [...SOURCE.matchAll(/^\s*if \(command === "([a-z-]+)"\)/gm)].map((m) => m[1]);
    const dispatched = [...new Set([...cases, ...earlies])].sort();
    expect(dispatched.length).toBeGreaterThan(10);
    expect(SUBCOMMANDS.map(([name]) => name).sort()).toEqual(dispatched);

    const text = usageLines().join("\n");
    for (const name of dispatched) expect(text, `用法里没有 ${name}`).toContain(name);
    // 手抄那版漏掉的正是这三条。
    for (const name of ["migrate", "run-check", "request-approval", "log"]) {
      expect(text).toContain(name);
    }
  });

  it("an unknown subcommand prints the generated usage and exits 2", () => {
    const r = run("wat");
    expect(r.status).toBe(2);
    for (const name of ["migrate", "run-check", "request-approval", "log"]) {
      expect(r.stderr).toContain(name);
    }
  });

  // ── D28: log — 把修改记录读出来 ───────────────────────────────────────────

  it("log prints one idea's append-only record", () => {
    const r = run("log", "I-001");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("2026-09-01");
    expect(r.stdout).toContain("创建");
    expect(r.stdout).toContain("想清楚了怎么做");
  });

  it("log with no id walks the whole graph, and says so when there is nothing", () => {
    const all = run("log");
    expect(all.status).toBe(0);
    expect(all.stdout).toContain("I-001");
    expect(all.stdout).toContain("想清楚了怎么做");

    const empty = run("log", "I-002");
    expect(empty.status).toBe(0);
    expect(empty.stdout).toMatch(/还没有任何修改记录/);
  });

  it("log --n keeps the tail, and an unknown id is an error", () => {
    const tail = run("log", "I-001", "--n", "1");
    expect(tail.stdout).toContain("想清楚了怎么做");
    expect(tail.stdout).not.toContain("创建");

    const missing = run("log", "I-404");
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("I-404");
  });

  // ── D29: 跳过了哪些，各自为什么 ───────────────────────────────────────────

  it("skippedFiles names every skipped path with the reason it was skipped", () => {
    mkdirSync(join(dir, "assets"), { recursive: true });
    mkdirSync(join(dir, "vendor"), { recursive: true });
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "assets", "logo.png"), "not really a png");
    writeFileSync(join(dir, "package-lock.json"), "{}");
    writeFileSync(join(dir, "vendor", "lib.ts"), "export const x = 1;\n");
    writeFileSync(join(dir, "src", "real.ts"), "export const real = 1;\n");
    writeFileSync(join(dir, "ideas", ".scanignore"), "src/real.ts\n");

    const skipped = skippedFiles(dir);
    const reasonOf = (f: string) => skipped.find((s) => s.file === f)?.reason;
    expect(reasonOf("assets/logo.png")).toMatch(/二进制/);
    expect(reasonOf("package-lock.json")).toMatch(/生成物/);
    expect(reasonOf("vendor/lib.ts")).toMatch(/依赖/);
    expect(reasonOf("ideas/graph.yaml")).toMatch(/账本/);
    expect(reasonOf("src/real.ts")).toMatch(/scanignore/);
    // 跳过的和留下的正好互补 —— 没有第三种「悄悄没了」的下场。
    for (const s of skipped) expect(listProjectFiles(dir)).not.toContain(s.file);
  });

  it("scan counts the skipped files and lists them with --skipped", () => {
    mkdirSync(join(dir, "assets"), { recursive: true });
    writeFileSync(join(dir, "assets", "logo.png"), "not really a png");

    const quiet = run("scan");
    expect(quiet.status).toBe(0);
    expect(quiet.stdout).toMatch(/跳过 \d+ 个文件/);
    expect(quiet.stdout).not.toContain("assets/logo.png");

    const loud = run("scan", "--skipped");
    expect(loud.status).toBe(0);
    expect(loud.stdout).toContain("assets/logo.png");
    expect(loud.stdout).toMatch(/二进制/);
  });

  // ── D30: 所有生成状态原子写 ───────────────────────────────────────────────

  it("nothing in the engine writes a generated file except the atomic helper", () => {
    const bare = SOURCE.split("\n")
      .filter((l) => /\bwriteFileSync\(/.test(l) && !/^import /.test(l.trim()))
      .filter((l) => !/writeFileSync\(tmp, text\)/.test(l));
    expect(bare, "D30：生成状态必须走 atomicWrite，不许直接落盘").toEqual([]);
  });

  it("a run that writes evidence, receipts, the graph and the page leaves no scratch file", () => {
    const r = run("scan");
    expect(r.status).toBe(0);
    const render = run("render");
    expect(render.status).toBe(0);
    const strays = readdirSync(join(dir, "ideas")).filter((f) => f.endsWith(".tmp"));
    expect(strays, "原子写的临时文件必须已经改名过去，不能留在账本目录里").toEqual([]);
  });
});
