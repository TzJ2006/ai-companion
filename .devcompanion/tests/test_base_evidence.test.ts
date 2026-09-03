import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseDocument } from "yaml";
import {
  load, graphPath, paths, setStatus, runCheck, redGateReady, greenCurrent, recordChange,
  requestApproval, applyApproval, check, decideProductWrite,
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

  /** 人真的回了一句「批准 CC-…」。run-check 从此要求这一步：verify.command 是图里
   *  的散文，人没过目就跑，等于让 agent 自己写一条命令再自己执行（D7）。 */
  const approvePlan = (id = "I-001") => {
    const { challenge } = requestApproval(dir, loadGraph(), "plan", [id]);
    expect(applyApproval(dir, `批准 ${challenge}`, meta)?.ok).toBe(true);
  };

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
    // 超时那条用得上：先离开临时目录再慢慢睡。超时杀的是 shell，慢进程会多活一
    // 会儿，留在临时目录里就会让 Windows 删不掉它。chdir 写在脚本里而不是命令里，
    // 命令才留得住「一条命令」的形状 —— 串起来的验证命令现在会被直接拒（D21/D28）。
    writeFileSync(join(dir, "slow.cjs"),
      `process.chdir(require("os").tmpdir());\nsetTimeout(function(){}, 10000);\n`);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  const implement = () => writeFileSync(join(dir, "impl.flag"), "built\n");

  // ── RED：一次真实失败，带退出码、输出尾和测试指纹 ────────────────────────

  it("red records the real failure: exit code, output tail, test hashes", { timeout: 60_000 }, () => {
    approvePlan();
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
    approvePlan();
    runCheck(dir, loadGraph(), "I-001", "red");
    expect(redGateReady(dir, loadGraph(), "I-001").ready).toBe(true);
    writeFileSync(join(dir, "tests", "a.test.txt"), "assert something ELSE\n");
    const g = redGateReady(dir, loadGraph(), "I-001");
    expect(g.ready).toBe(false);
    expect(g.reason).toMatch(/stale|变|过期/);
  });

  // ── 意外先绿：不豁免不放行 ───────────────────────────────────────────────

  it("an unexpectedly passing red is recorded and blocks until a red-waiver", { timeout: 60_000 }, () => {
    approvePlan();
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
    approvePlan();
    expect(() => runCheck(dir, loadGraph(), "I-001", "green")).toThrow(/red|RED/i);
  });

  it("red → implement → green → done; another write staleness-kills green", { timeout: 60_000 }, () => {
    approvePlan();
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
    approvePlan();
    runCheck(dir, loadGraph(), "I-001", "red");
    implement();
    runCheck(dir, loadGraph(), "I-001", "green");
    recordChange(dir, loadGraph(), "src/b.ts");      // I-002 的文件
    expect(greenCurrent(dir, loadGraph(), "I-001")).toBe(true);
  });

  it("editing the test file after green voids it too", { timeout: 60_000 }, () => {
    approvePlan();
    runCheck(dir, loadGraph(), "I-001", "red");
    implement();
    runCheck(dir, loadGraph(), "I-001", "green");
    writeFileSync(join(dir, "tests", "a.test.txt"), "assert a THIRD thing\n");
    expect(greenCurrent(dir, loadGraph(), "I-001")).toBe(false);
  });

  // ── H5：命令没跑起来 ≠ 测试红了；没有测试文件也不算红 ────────────────────
  // 验证命令打错一个字、超时被杀、或者想法根本没有测试文件时，退出码同样非零。
  // 若把这些都当成 RED，实现的门就被一个错别字打开了（D8：先有真实失败）。

  /** 同一张图，只把 I-001 的验证命令换掉 —— 换在盘上，再重新请一次批准。改
   *  verify 会作废旧批准，而 run-check 只跑人批过的那条命令（D7）：只改内存里的
   *  那份，快照对不上，命令根本不会被交给 shell。 */
  const withCommand = (command: string): Graph => {
    const g = rewrite(yaml.replace(`command: "node checker.cjs"`, `command: "${command}"`));
    approvePlan();
    return g;
  };

  it("a command that does not exist is an infrastructure error, never a red", { timeout: 60_000 }, () => {
    const g = withCommand("definitely-not-a-real-command-zzz --run");
    const r = runCheck(dir, g, "I-001", "red");
    expect(r.outcome).toBe("infra_error");
    const gate = redGateReady(dir, g, "I-001");
    expect(gate.ready).toBe(false);
    expect(gate.reason).toMatch(/命令/);          // 说清楚是命令坏了
    expect(gate.reason).not.toMatch(/测试文件/);  // 不是「没有测试文件」那一种
  });

  it("a timed-out command is an infrastructure error, never a red", { timeout: 60_000 }, () => {
    // slow.cjs 自己 chdir 出临时目录（见 beforeEach）：命令保持单条，超时照样发生。
    const g = withCommand("node slow.cjs");
    const r = runCheck(dir, g, "I-001", "red", { timeoutMs: 800 });
    expect(r.outcome).toBe("infra_error");
    expect(redGateReady(dir, g, "I-001").ready).toBe(false);
  });

  it("an idea whose declared test file does not exist cannot open the gate", { timeout: 60_000 }, () => {
    approvePlan();
    rmSync(join(dir, "tests", "a.test.txt"));
    expect(redGateReady(dir, loadGraph(), "I-001").ready).toBe(false);

    runCheck(dir, loadGraph(), "I-001", "red");   // 命令照样退出 1
    const gate = redGateReady(dir, loadGraph(), "I-001");
    expect(gate.ready).toBe(false);
    expect(gate.reason).toMatch(/测试文件/);
  });

  it("an idea that declares no test files at all cannot open the gate", { timeout: 60_000 }, () => {
    const g = rewrite(noTestFiles);      // 换在盘上：批准是按盘上的图算的（D7）
    approvePlan();
    runCheck(dir, g, "I-001", "red");
    const gate = redGateReady(dir, g, "I-001");
    expect(gate.ready).toBe(false);
    expect(gate.reason).toMatch(/test_files|测试文件/);
  });

  it("a genuine failing test still opens the gate", { timeout: 60_000 }, () => {
    approvePlan();
    const r = runCheck(dir, loadGraph(), "I-001", "red");
    expect(r.outcome).toBe("red");
    expect(redGateReady(dir, loadGraph(), "I-001").ready).toBe(true);
  });

  // ── 整项目命令 + 没有测试文件：拦得住，但不是死路 ────────────────────────
  // 没有测试文件时命令的非零退出可能来自任何地方，所以它自己不算 RED（上面那
  // 条）；可是「一条整项目命令、没有 test_files」是活账本里最常见的形状，硬拒
  // 等于把这些想法永远锁死，而唯一的解套动作（往图里补 test_files）会改掉
  // verify、作废刚拿到的计划批准。出路必须存在：命令真活着、真跑过一次，再加
  // 一次人批的 red-waiver（D8）。

  /** 把磁盘上的图换掉 —— 批准是按盘上的图重算的，只改内存对不上。 */
  const rewrite = (text: string): Graph => {
    writeFileSync(join(dir, "ideas", "graph.yaml"), text);
    return loadGraph();
  };
  // `replace` 只换第一处，也就是 I-001 的那一处。
  const noTestFiles = yaml.replace("      test_files: [ tests/a.test.txt ]\n", "");
  const noTestFilesBrokenCommand =
    noTestFiles.replace(`command: "node checker.cjs"`, `command: "definitely-not-a-real-command-zzz --run"`);

  it("an idea with a command and no test files is not stranded: red-waiver is the way out", { timeout: 60_000 }, () => {
    rewrite(noTestFiles);
    approvePlan();
    const r = runCheck(dir, loadGraph(), "I-001", "red");   // 命令真跑了，真失败了
    expect(r.outcome).toBe("red");

    const gate = redGateReady(dir, loadGraph(), "I-001");
    expect(gate.ready).toBe(false);
    expect(gate.reason).toMatch(/test_files/);              // 出路一：补测试文件
    expect(gate.reason).toMatch(/red-waiver/);              // 出路二：人批一次

    const { challenge } = requestApproval(dir, loadGraph(), "red-waiver", ["I-001"]);
    expect(applyApproval(dir, `批准 ${challenge}`, meta)?.ok).toBe(true);
    expect(redGateReady(dir, loadGraph(), "I-001").ready).toBe(true);

    // 守卫真正问的那一问：实现文件终于写得进去了，人也确实过目过。
    const plan = requestApproval(dir, loadGraph(), "plan", ["I-001"]);
    expect(applyApproval(dir, `批准 ${plan.challenge}`, meta)?.ok).toBe(true);
    expect(decideProductWrite(dir, loadGraph(), "src/a.ts").allow).toBe(true);
  });

  it("no test files + a command that does not exist: not even a red-waiver opens the gate", { timeout: 60_000 }, () => {
    rewrite(noTestFilesBrokenCommand);
    approvePlan();
    expect(runCheck(dir, loadGraph(), "I-001", "red").outcome).toBe("infra_error");

    const { challenge } = requestApproval(dir, loadGraph(), "red-waiver", ["I-001"]);
    expect(applyApproval(dir, `批准 ${challenge}`, meta)?.ok).toBe(true);

    const gate = redGateReady(dir, loadGraph(), "I-001");
    expect(gate.ready).toBe(false);
    expect(gate.reason).toMatch(/命令/);          // 命令坏了，人批也不算证据
  });

  it("check warns — not errors — about a doing idea with a command and no test files", () => {
    const g = rewrite(noTestFiles);
    const { errors, warnings } = check(g, dir);
    expect(errors).toEqual([]);
    expect(warnings.join()).toMatch(/I-001/);
    expect(warnings.join()).toMatch(/test_files/);
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
