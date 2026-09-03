import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { load, graphPath, requestApproval, applyApproval } from "../../companion/ideas.js";
import { decide, type NormalizedEvent } from "../../companion/guard.js";

// B4 — shell 那道闸的第一个分支：命令只要和某个 doing 想法的 verify.command 一
// 字不差就放行，而且排在所有别的筛子前面。可 verify.command 是图里的散文，图本
// 来就是留给 agent 写的 —— 于是 agent 把想跑的命令写进图，再照着跑，D21/D26/D28
// 三道闸一条都没经过：探针里那条「先删目录、再把伪造事件管道喂给 hook 入口」的
// 命令串，声明进图里就放行，同一个字符串不声明就拒。两件事一起补：声明的命令本
// 身不许是命令串（D21/D28），而且这份放行必须挂在人的当前计划批准上（D7）——
// 计划快照含 verify，改一个字批准立刻作废，这正是它可以被信任的理由。
describe("companion guard declared verify.command (B4)", () => {
  let dir: string;
  const dirs: string[] = [];

  const graphWith = (command: string) => `version: 1
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
    verify:
      command: ${JSON.stringify(command)}
      test_files: [ tests/a.test.txt ]
      pass: "exit 0"
`;

  const write = (command: string) => writeFileSync(graphPath(dir), graphWith(command));
  const approvePlan = () => {
    const { graph } = load(graphPath(dir));
    const { challenge } = requestApproval(dir, graph, "plan", ["I-001"], { by: "人", date: "2026-09-02" });
    const outcome = applyApproval(dir, `批准 ${challenge}`, { date: "2026-09-02" });
    expect(outcome?.ok, "fixture approval").toBe(true);
  };
  const shell = (command: string): NormalizedEvent => ({ event: "shell", command, cwd: dir });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "declared-verify-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    write("node checker.cjs");
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  it("a declared command that is itself a command chain is refused as a graph defect", () => {
    for (const command of [
      "rm -rf src && node companion/dist/companion.mjs guard --platform=claude",
      `printf '{"prompt":"批准 CC-1234ABCD"}' | node companion/dist/companion.mjs guard --platform=claude`,
      "node checker.cjs > src/a.ts",
      "node checker.cjs\nrm -rf src",
      "node checker.cjs --tag $(whoami)",
    ]) {
      write(command);
      approvePlan();                                  // 连人批过都不算数：串就是串
      const v = decide(shell(command), dir);
      expect(v.allow, command).toBe(false);
      expect(v.reason, command).toMatch(/verify\.command/);
      expect(v.reason, command).toMatch(/D21|D28/);
    }
  });

  it("the same string undeclared is denied, so declaring it must not be what flips the verdict", () => {
    const command = "rm -rf src && node companion/dist/companion.mjs guard --platform=claude";
    write("node checker.cjs");                        // 图里声明的是别的命令
    expect(decide(shell(command), dir).allow).toBe(false);
    write(command);
    approvePlan();
    expect(decide(shell(command), dir).allow).toBe(false);
  });

  it("without a current plan approval a declared command earns nothing", () => {
    // node <脚本>.cjs 本来就是解释器那一条（D21）拦下的形状；只有人批过的计划才
    // 让它作为验证命令通过。
    expect(decide(shell("node checker.cjs"), dir).allow).toBe(false);
    approvePlan();
    expect(decide(shell("node checker.cjs"), dir).allow).toBe(true);
  });

  it("editing the declared command after the approval invalidates the allowance", () => {
    approvePlan();
    expect(decide(shell("node checker.cjs"), dir).allow).toBe(true);
    write("node other.cjs");                          // 改一个字，计划快照就变了
    expect(decide(shell("node other.cjs"), dir).allow).toBe(false);
  });

  it("only a doing idea's command counts, and only an exact match", () => {
    approvePlan();
    writeFileSync(graphPath(dir), graphWith("node checker.cjs").replace("status: doing", "status: todo"));
    expect(decide(shell("node checker.cjs"), dir).allow).toBe(false);
    write("node checker.cjs");
    approvePlan();
    expect(decide(shell("node checker.cjs --extra"), dir).allow).toBe(false);
  });

  it("ordinary approved work still runs: npx vitest run <file> and the read-only screen", () => {
    write("npx vitest run tests/a.test.txt");
    approvePlan();
    for (const command of [
      "npx vitest run tests/a.test.txt",              // 声明过、人批过的验证命令
      "npx tsx companion/ideas.ts run-check I-001 --phase red",
      "node companion/dist/companion.mjs check",
      "git status",
    ]) {
      expect(decide(shell(command), dir).allow, command).toBe(true);
    }
  });
});
