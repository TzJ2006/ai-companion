import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  load, graphPath, paths, requestApproval, applyApproval, runCheck,
} from "../../companion/ideas.js";
import { decide, record, type NormalizedEvent } from "../../companion/guard.js";

// I-093 — 一份三家共用的规则核心：归一化事件进，允许/拒绝加一句人话理由出。
// 规则逐条有正反例：默认拒绝（D16）、测试先写永远合法、没批准不许写（D7/D17）、
// 没有失败测试记录不许写实现（D8）、程序保管的证据不许直接写（D24）、账本可编辑
// 但 status/signed_off 只能走 CLI（R2/D27）、shell 旁路同拦（D21）、目标不明直接
// 拒（D23）、Stop 前图必须校验通过、写前崩溃拦下写后崩溃放行（D9）、
// AIDEV_GUARD=off 放行但明说（D25）。
describe("companion guard rule core (I-093)", () => {
  let dir: string;
  const dirs: string[] = [];

  const yaml = `version: 1
project: fixture
endpoints: [I-001]
ideas:
  - id: I-001
    name: "进行中的想法"
    status: doing
    needs: []
    what: W
    why: Y
    expected: E
    how: H
    why_this_way: T
    future: F
    code:
      - file: src/a.ts
        symbol: a
    verify:
      command: "node checker.cjs"
      test_files: [ tests/a.test.txt ]
      pass: "exit 0"
  - id: I-002
    name: "等人验收的想法"
    status: todo
    needs: [I-001]
    what: W2
    why: Y2
    expected: E2
    how: H2
    why_this_way: T2
    future: F2
    code:
      - file: src/b.ts
    verify:
      manual: "亲眼看一遍"
      signed_off: null
`;

  const meta = { date: "2026-09-01" };
  const loadGraph = () => load(graphPath(dir)).graph;

  const ev = (over: Partial<NormalizedEvent>): NormalizedEvent => ({
    event: "pre-write", tool: "Edit", cwd: dir, ...over,
  });

  const approvePlan = () => {
    const { challenge } = requestApproval(dir, loadGraph(), "plan", ["I-001"]);
    applyApproval(dir, `批准 ${challenge}`, meta);
  };
  const recordRed = () => runCheck(dir, loadGraph(), "I-001", "red");

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "guard-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    mkdirSync(join(dir, "tests"), { recursive: true });
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
    writeFileSync(join(dir, "tests", "a.test.txt"), "assert the thing\n");
    writeFileSync(join(dir, "src", "a.ts"), "// not yet\n");
    writeFileSync(join(dir, "checker.cjs"), `process.exit(require("fs").existsSync("impl.flag") ? 0 : 1);\n`);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  // ── 测试先写永远合法；实现要批准 + RED，一层都不能少 ─────────────────────

  it("writing the doing idea's test file is legal from the very start", () => {
    const v = decide(ev({ paths: [join(dir, "tests", "a.test.txt")] }), dir);
    expect(v.allow).toBe(true);
  });

  it("implementation without a plan approval is denied, and the reason says so", () => {
    recordRed();
    const v = decide(ev({ paths: [join(dir, "src", "a.ts")] }), dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/批准|plan/);
  });

  it("implementation with approval but no RED is denied", () => {
    approvePlan();
    const v = decide(ev({ paths: [join(dir, "src", "a.ts")] }), dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/RED|red|失败/);
  });

  it("approval + RED opens the gate", () => {
    approvePlan();
    recordRed();
    expect(decide(ev({ paths: [join(dir, "src", "a.ts")] }), dir).allow).toBe(true);
  });

  // ── 默认拒绝（D16） ──────────────────────────────────────────────────────

  it("a file no idea claims is denied", () => {
    const v = decide(ev({ paths: [join(dir, "src", "x.ts")] }), dir);
    expect(v.allow).toBe(false);
  });

  it("with nothing doing at all, product writes are denied with that reason", () => {
    writeFileSync(graphPath(dir), yaml.replace("status: doing", "status: todo"));
    const v = decide(ev({ paths: [join(dir, "src", "a.ts")] }), dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/进行中|doing/);
  });

  // ── 账本可编辑，但 status / signed_off 只能走 CLI ────────────────────────

  it("narrative edits to the graph are allowed", () => {
    const v = decide(ev({
      paths: [graphPath(dir)],
      edit: { old_string: "how: H2", new_string: "how: 改了实现思路" },
    }), dir);
    expect(v.allow).toBe(true);
  });

  it("hand-flipping a status in the graph is denied — use set", () => {
    const v = decide(ev({
      paths: [graphPath(dir)],
      edit: { old_string: "status: todo", new_string: "status: done" },
    }), dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/set/);
  });

  it("hand-writing a manual signature is denied — it must come from a challenge", () => {
    const v = decide(ev({
      paths: [graphPath(dir)],
      edit: { old_string: "signed_off: null", new_string: 'signed_off: "张三说好了"' },
    }), dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/签|signed/);
  });

  // ── 程序保管的证据谁都不许直接写（D24） ──────────────────────────────────

  it("runtime evidence, approval receipts, scan lists and generated html are all deny", () => {
    for (const target of [
      join(paths(dir).runtime, "I-001.json"),
      paths(dir).approved,
      paths(dir).worklist,
      paths(dir).done,
      paths(dir).html,
    ]) {
      const v = decide(ev({ paths: [target] }), dir);
      expect(v.allow, target).toBe(false);
    }
  });

  it("the prose log stays writable", () => {
    expect(decide(ev({ paths: [paths(dir).log] }), dir).allow).toBe(true);
  });

  // ── 目标不明直接拒（D23） ────────────────────────────────────────────────

  it("a write whose target cannot be determined is denied, not waved through", () => {
    const v = decide(ev({ paths: [], unknownTarget: true }), dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/目标|unknown/i);
  });

  // ── shell 旁路（D21） ────────────────────────────────────────────────────

  it("shell mutations are denied: redirects, in-place edits, one-liner interpreters, git rewrites", () => {
    for (const command of [
      "echo hacked > src/a.ts",
      "sed -i 's/a/b/' src/a.ts",
      `python -c "open('x','w').write('1')"`,
      "node -e \"require('fs').writeFileSync('x','1')\"",
      "git checkout -- .",
      "npm install left-pad",
    ]) {
      const v = decide(ev({ event: "shell", command, paths: [] }), dir);
      expect(v.allow, command).toBe(false);
    }
  });

  it("read-only commands, the declared verify command, and the companion CLI pass", () => {
    for (const command of [
      "git status",
      "node checker.cjs",                       // I-001 声明的验证命令
      "npx tsx companion/ideas.ts check",
      "node companion/dist/companion.mjs next",
    ]) {
      const v = decide(ev({ event: "shell", command, paths: [] }), dir);
      expect(v.allow, command).toBe(true);
    }
  });

  it("a companion CLI call smuggling shell metacharacters is not the companion CLI", () => {
    const v = decide(ev({ event: "shell", command: "npx tsx companion/ideas.ts check; rm -rf src" }), dir);
    expect(v.allow).toBe(false);
  });

  // ── Stop：图必须校验通过 ─────────────────────────────────────────────────

  it("stop is blocked while the graph has errors, unless already continuing", () => {
    expect(decide(ev({ event: "stop", paths: [] }), dir).allow).toBe(true);
    writeFileSync(graphPath(dir), yaml.replace("needs: [I-001]", "needs: [I-999]"));
    const v = decide(ev({ event: "stop", paths: [] }), dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/I-999|错误/);
    expect(decide(ev({ event: "stop", paths: [], stop_hook_active: true }), dir).allow).toBe(true);
  });

  // ── 写后：记录，并给证据计数器加一；崩溃只警告 ───────────────────────────

  it("post-write records the change and bumps the claiming idea's counter", () => {
    const v = record(ev({ event: "post-write", tool: "Edit", paths: [join(dir, "src", "a.ts")] }), dir);
    expect(v.allow).toBe(true);
    const evidence = JSON.parse(readFileSync(join(paths(dir).runtime, "I-001.json"), "utf8"));
    expect(evidence.change_seq).toBe(1);
    expect(readFileSync(paths(dir).log, "utf8")).toContain("src/a.ts");
  });

  // ── 崩溃方向（D9）：写前拦下，写后放行 ───────────────────────────────────

  it("a corrupt graph fails CLOSED on pre-write and OPEN on post-write", () => {
    writeFileSync(graphPath(dir), ":::: not yaml at all\n\t*");
    const pre = decide(ev({ paths: [join(dir, "src", "a.ts")] }), dir);
    expect(pre.allow).toBe(false);
    const post = record(ev({ event: "post-write", paths: [join(dir, "src", "a.ts")] }), dir);
    expect(post.allow).toBe(true);
  });

  // ── 逃生口（D25） ────────────────────────────────────────────────────────

  it("AIDEV_GUARD=off allows everything but says so out loud", () => {
    const v = decide(ev({ paths: [paths(dir).approved] }), dir, { guardOff: true });
    expect(v.allow).toBe(true);
    expect(v.warn).toMatch(/AIDEV_GUARD/);
  });
});
