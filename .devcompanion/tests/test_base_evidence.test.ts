import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseDocument } from "yaml";
import {
  load, graphPath, paths, setStatus, runCheck, redGateReady, greenCurrent, recordChange,
  requestApproval, applyApproval,
  type Graph,
} from "../../companion/ideas.js";

// I-091 — Codex 版测试先行证据链进入共同基座：实现之前必须有一次「测试真的
// 失败了」的记录（RED）；实现文件每写一次旧的通过记录（GREEN）就过期；
// 标 done 必须有当前有效的 GREEN。意外先绿要走一次 red-waiver（I-090 的挑战链）。
// 裁决依据：D8（RED→GREEN 证据不回退）、D20（done 永远要求当前 GREEN）。
describe("companion red/green evidence (I-091)", () => {
  let dir: string;
  const dirs: string[] = [];

  // verify.command 跑 checker.cjs：impl.flag 存在就 0（绿），不存在就 1（红）。
  const yaml = `version: 1
project: fixture
endpoints: [I-001]
ideas:
  - id: I-001
    name: "被证据链看管的想法"
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
    name: "另一个想法，写它的文件不该动到 I-001 的证据"
    status: doing
    needs: []
    what: W
    why: Y
    expected: E
    how: H
    why_this_way: T
    future: F
    code:
      - file: src/b.ts
    verify:
      command: "node checker.cjs"
      test_files: [ tests/b.test.txt ]
      pass: "exit 0"
`;

  const loadGraph = () => load(graphPath(dir)).graph;
  const meta = { date: "2026-09-01" };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "evid-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    mkdirSync(join(dir, "tests"), { recursive: true });
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
    writeFileSync(join(dir, "tests", "a.test.txt"), "assert the thing\n");
    writeFileSync(join(dir, "tests", "b.test.txt"), "assert the other thing\n");
    writeFileSync(join(dir, "src", "a.ts"), "// not yet\n");
    writeFileSync(join(dir, "checker.cjs"),
      `process.exit(require("fs").existsSync("impl.flag") ? 0 : 1);\n`);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  const implement = () => writeFileSync(join(dir, "impl.flag"), "built\n");

  // ── RED：一次真实失败，带退出码、输出尾和测试指纹 ────────────────────────

  it("red records the real failure: exit code, output tail, test hashes", { timeout: 60_000 }, () => {
    const r = runCheck(dir, loadGraph(), "I-001", "red");
    expect(r.outcome).toBe("red");
    expect(r.exit_code).toBe(1);
    const evidence = JSON.parse(readFileSync(join(paths(dir).runtime, "I-001.json"), "utf8"));
    expect(evidence.red.exit_code).toBe(1);
    expect(Object.keys(evidence.red.test_hashes)).toContain("tests/a.test.txt");
  });

  it("no red yet → the gate is not ready and says why", () => {
    const g = redGateReady(dir, loadGraph(), "I-001");
    expect(g.ready).toBe(false);
    expect(g.reason).toMatch(/red|RED|失败/i);
  });

  it("editing the test file after red voids the evidence", { timeout: 60_000 }, () => {
    runCheck(dir, loadGraph(), "I-001", "red");
    expect(redGateReady(dir, loadGraph(), "I-001").ready).toBe(true);
    writeFileSync(join(dir, "tests", "a.test.txt"), "assert something ELSE\n");
    const g = redGateReady(dir, loadGraph(), "I-001");
    expect(g.ready).toBe(false);
    expect(g.reason).toMatch(/stale|变|过期/);
  });

  // ── 意外先绿：不豁免不放行 ───────────────────────────────────────────────

  it("an unexpectedly passing red is recorded and blocks until a red-waiver", { timeout: 60_000 }, () => {
    implement();                                     // 测试还没写就已经绿了
    const r = runCheck(dir, loadGraph(), "I-001", "red");
    expect(r.outcome).toBe("unexpected_pass");
    expect(redGateReady(dir, loadGraph(), "I-001").ready).toBe(false);

    const { challenge } = requestApproval(dir, loadGraph(), "red-waiver", ["I-001"]);
    expect(applyApproval(dir, `批准 ${challenge}`, meta)?.ok).toBe(true);
    expect(redGateReady(dir, loadGraph(), "I-001").ready).toBe(true);
  });

  // ── GREEN：先红才能绿；实现再动一笔就过期 ────────────────────────────────

  it("green refuses to run before the red gate is ready", () => {
    expect(() => runCheck(dir, loadGraph(), "I-001", "green")).toThrow(/red|RED/i);
  });

  it("red → implement → green → done; another write staleness-kills green", { timeout: 60_000 }, () => {
    runCheck(dir, loadGraph(), "I-001", "red");
    implement();
    const g = runCheck(dir, loadGraph(), "I-001", "green");
    expect(g.exit_code).toBe(0);
    expect(greenCurrent(dir, loadGraph(), "I-001")).toBe(true);

    // 实现文件又被写了一次 —— 通过记录随之过期
    recordChange(dir, loadGraph(), "src/a.ts");
    expect(greenCurrent(dir, loadGraph(), "I-001")).toBe(false);

    // 不重跑就想 done：拒
    const { doc, graph } = load(graphPath(dir));
    expect(() => setStatus(doc, graph, "I-001", "done", { date: "2026-09-01" }, dir))
      .toThrow(/GREEN|过期|run-check/);

    // 重跑绿了就放行
    runCheck(dir, loadGraph(), "I-001", "green");
    const again = load(graphPath(dir));
    setStatus(again.doc, again.graph, "I-001", "done", { date: "2026-09-01" }, dir);
    expect(String(again.doc)).toContain("status: done");
  });

  it("writes to another idea's files do not stale this idea's green", { timeout: 60_000 }, () => {
    runCheck(dir, loadGraph(), "I-001", "red");
    implement();
    runCheck(dir, loadGraph(), "I-001", "green");
    recordChange(dir, loadGraph(), "src/b.ts");      // I-002 的文件
    expect(greenCurrent(dir, loadGraph(), "I-001")).toBe(true);
  });

  it("editing the test file after green voids it too", { timeout: 60_000 }, () => {
    runCheck(dir, loadGraph(), "I-001", "red");
    implement();
    runCheck(dir, loadGraph(), "I-001", "green");
    writeFileSync(join(dir, "tests", "a.test.txt"), "assert a THIRD thing\n");
    expect(greenCurrent(dir, loadGraph(), "I-001")).toBe(false);
  });

  it("a manual-only idea needs no red gate — its done gate is the signature", () => {
    const doc = parseDocument(yaml.replace(
      `command: "node checker.cjs"
      test_files: [ tests/a.test.txt ]
      pass: "exit 0"`,
      `manual: "亲眼看一遍"`));
    const g = doc.toJSON() as Graph;
    expect(redGateReady(dir, g, "I-001").ready).toBe(true);
  });
});
