import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, copyFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// I-096 — 引擎、守卫和 yaml 依赖打成一个 dist/companion.mjs，装到哪里只要有
// node 就能跑：没有 npx、没有 tsx、没有 node_modules。banner 里的 createRequire
// 垫片不可省 —— 没有它构建全绿、第一次解析 YAML 当场崩（调研在本机复现过）。
// 裁决依据：D34。
describe("companion single-file bundle (I-096)", () => {
  const ROOT = resolve(fileURLToPath(import.meta.url), "../../..");
  const BUNDLE = join(ROOT, "companion", "dist", "companion.mjs");
  const dirs: string[] = [];
  const sh = process.platform === "win32";

  beforeAll(() => {
    const built = spawnSync("node", [join(ROOT, "companion", "build.mjs")],
      { encoding: "utf8", cwd: ROOT, timeout: 120_000 });
    expect(built.status, built.stderr).toBe(0);
  }, 180_000);
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  it("the artifact exists, starts with a shebang, and carries the createRequire shim", () => {
    const head = readFileSync(BUNDLE, "utf8").slice(0, 300);
    expect(head.startsWith("#!/usr/bin/env node")).toBe(true);
    expect(head).toContain("createRequire");
  });

  it("runs the engine with plain node in a directory with no node_modules", { timeout: 60_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "bundle-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    copyFileSync(BUNDLE, join(dir, "companion.mjs"));
    writeFileSync(join(dir, "ideas", "graph.yaml"),
      `version: 1\nproject: p\nendpoints: [I-001]\nideas:\n  - id: I-001\n    name: "唯一的想法"\n    status: todo\n    needs: []\n`);
    expect(existsSync(join(dir, "node_modules"))).toBe(false);

    const check = spawnSync("node", [join(dir, "companion.mjs"), "check", "--project", dir],
      { encoding: "utf8", cwd: dir, timeout: 60_000 });
    expect(check.status, `${check.stdout}${check.stderr}`).toBe(0);
    expect(check.stdout).toContain("1 ideas");

    const pathsRun = spawnSync("node", [join(dir, "companion.mjs"), "paths", "--project", dir],
      { encoding: "utf8", cwd: dir, timeout: 60_000 });
    expect(pathsRun.status).toBe(0);
    expect(pathsRun.stdout).toContain("ideas/graph.yaml");
  });

  it("runs the guard from the same artifact: a violating event exits 2", { timeout: 60_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "bundle-g-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    copyFileSync(BUNDLE, join(dir, "companion.mjs"));
    writeFileSync(join(dir, "ideas", "graph.yaml"),
      `version: 1\nproject: p\nideas: []\n`);

    const input = JSON.stringify({
      hook_event_name: "PreToolUse", tool_name: "Write",
      tool_input: { file_path: join(dir, "src", "x.ts"), content: "x" }, cwd: dir,
    });
    const r = spawnSync("node", [join(dir, "companion.mjs"), "guard", "--platform=claude"],
      { input, encoding: "utf8", cwd: dir, timeout: 60_000 });
    expect(r.status).toBe(2);
  });

  it("the build is reproducible: building again succeeds and stays runnable", { timeout: 120_000 }, () => {
    const again = spawnSync("node", [join(ROOT, "companion", "build.mjs")],
      { encoding: "utf8", cwd: ROOT, timeout: 120_000 });
    expect(again.status, again.stderr).toBe(0);
    const r = spawnSync("node", [BUNDLE, "paths", "--project", tmpdir()],
      { encoding: "utf8", timeout: 60_000 });
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
  });
});
