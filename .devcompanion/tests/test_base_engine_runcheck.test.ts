import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  load, graphPath, runCheck, requestApproval, applyApproval,
  type Graph,
} from "../../companion/ideas.js";

// 守卫在 shell 那一侧已经把「原样放行的验证命令」关上了两道闸：命令必须是**一条**
// 命令，且这条想法必须带着当前有效的计划批准。可引擎自己也会跑同一条命令 ——
// `run-check` 把 idea.verify.command 原样交给 shell —— 而 run-check 就在守卫的引擎
// 白名单上。verify.command 是图里的散文，本来就允许 agent 自己写；守卫当面拒掉的那
// 条命令，绕道 run-check 就跑起来了：墙上开了一扇门。
// 裁决依据：D7（实现要人过目的计划批准）、D21（shell 写文件走同一道闸）、
// D28（引擎调用不许夹带第二条命令）、D11（同一条规则只许有一份实现）。
describe("run-check applies the guard's two conditions at the engine's own point of execution", () => {
  let dir: string;
  const dirs: string[] = [];
  const ENGINE = resolve(fileURLToPath(import.meta.url), "../../../companion/ideas.ts");
  const meta = { date: "2026-09-02" };

  /** 同一张图，只换 I-001 的验证命令 —— 写到盘上，因为批准是按盘上的图算的。 */
  const graphYaml = (command: string) => `version: 1
project: fixture
endpoints: [I-001]
ideas:
  - id: I-001
    name: "带验证命令的想法"
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
      command: "${command}"
      test_files: [ tests/a.test.txt ]
      pass: "exit 0"
`;

  const plant = (command: string): Graph => {
    writeFileSync(join(dir, "ideas", "graph.yaml"), graphYaml(command));
    return load(graphPath(dir)).graph;
  };

  /** 人真的回了一句「批准 CC-…」—— agent 造不出来的那一步。 */
  const approvePlan = () => {
    const { challenge } = requestApproval(dir, load(graphPath(dir)).graph, "plan", ["I-001"]);
    expect(applyApproval(dir, `批准 ${challenge}`, meta)?.ok).toBe(true);
  };

  const ran = () => existsSync(join(dir, "ran.flag"));       // 验证命令自己跑过了
  const pwned = () => existsSync(join(dir, "pwned.txt"));    // 夹带的第二条命令跑过了

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "runcheck-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    mkdirSync(join(dir, "tests"), { recursive: true });
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "tests", "a.test.txt"), "assert the thing\n");
    writeFileSync(join(dir, "src", "a.ts"), "// not yet\n");
    // 真验证命令：留个脚印，impl.flag 在就绿、不在就红。
    writeFileSync(join(dir, "checker.cjs"),
      `require("fs").writeFileSync("ran.flag", "checker ran\\n");\n`
      + `process.exit(require("fs").existsSync("impl.flag") ? 0 : 1);\n`);
    // 夹带的那一条：只要它跑起来，墙就是漏的。
    writeFileSync(join(dir, "payload.cjs"),
      `require("fs").writeFileSync("pwned.txt", "second command ran\\n");\n`);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  // ── 条件一：验证命令只能是一条命令（D21/D28） ─────────────────────────────
  // 串起来的第二条命令人从没看过。这不是悄悄跳过，是当着人的面拒 —— 图里放着一
  // 件要人过目的东西。

  for (const [shape, command] of [
    ["与号", "node checker.cjs && node payload.cjs"],
    ["分号", "node checker.cjs ; node payload.cjs"],
    ["管道", "node checker.cjs | node payload.cjs"],
    ["重定向", "node checker.cjs > out.txt"],
    ["命令替换", "node checker.cjs $(node payload.cjs)"],
    ["反引号", "node checker.cjs `node payload.cjs`"],
  ] as const) {
    it(`a chained verify command (${shape}) is refused outright, and nothing runs`, { timeout: 60_000 }, () => {
      const g = plant(command);
      approvePlan();                                  // 批准也救不了：串了就是图有毛病
      // 先问「跑了没有」再问「拒了没有」：漏的是执行，不是措辞。
      let refusal: unknown = null;
      try { runCheck(dir, g, "I-001", "red"); } catch (error) { refusal = error; }
      expect(pwned(), "夹带的第二条命令跑起来了").toBe(false);
      expect(ran(), "验证命令根本不该被交给 shell").toBe(false);
      expect(String(refusal)).toMatch(/一条命令/);
    });
  }

  // ── 条件二：没有当前有效的计划批准就不跑（D7） ────────────────────────────

  it("without a current plan approval the declared command is never handed to a shell", { timeout: 60_000 }, () => {
    const g = plant("node checker.cjs");
    expect(() => runCheck(dir, g, "I-001", "red")).toThrow(/批准/);
    expect(ran()).toBe(false);
  });

  it("editing verify.command after the approval voids it — the new command never runs", { timeout: 60_000 }, () => {
    plant("node checker.cjs");
    approvePlan();
    const swapped = plant("node payload.cjs");         // 图一改，刚拿到的批准就作废
    expect(() => runCheck(dir, swapped, "I-001", "red")).toThrow(/批准/);
    expect(pwned()).toBe(false);
  });

  it("a command smuggled in through an in-memory graph the human never saw is refused", { timeout: 60_000 }, () => {
    plant("node checker.cjs");
    approvePlan();
    const doctored = load(graphPath(dir)).graph;       // 盘上是批过的，内存里换掉
    doctored.ideas.find((i) => i.id === "I-001")!.verify!.command = "node payload.cjs";
    expect(() => runCheck(dir, doctored, "I-001", "red")).toThrow(/批准/);
    expect(pwned()).toBe(false);
  });

  // ── 正路一步没少：批过的 doing 想法照常产出红绿证据 ───────────────────────

  it("the sanctioned path still works: an approved idea records RED then GREEN", { timeout: 60_000 }, () => {
    const g = plant("node checker.cjs");
    approvePlan();
    const red = runCheck(dir, g, "I-001", "red");
    expect(red.outcome).toBe("red");
    expect(red.exit_code).toBe(1);
    expect(ran()).toBe(true);

    writeFileSync(join(dir, "impl.flag"), "built\n");
    const green = runCheck(dir, load(graphPath(dir)).graph, "I-001", "green");
    expect(green.exit_code).toBe(0);
  });

  // ── 真正被利用的那条路：命令行子命令 ─────────────────────────────────────

  it("the CLI subcommand is gated too, and the ordinary invocation still passes", { timeout: 300_000 }, () => {
    const cli = (...extra: string[]) => spawnSync("npx",
      ["tsx", ENGINE, "run-check", "I-001", "--phase", "red", "--project", dir, ...extra],
      { encoding: "utf8", shell: process.platform === "win32", timeout: 240_000 });

    plant("node checker.cjs && node payload.cjs");
    approvePlan();
    const denied = cli();
    expect(denied.status).toBe(1);
    expect(`${denied.stdout}${denied.stderr}`).toMatch(/一条命令/);
    expect(pwned(), "守卫当面拒掉的载荷，绕道引擎跑起来了").toBe(false);

    plant("node checker.cjs");
    approvePlan();
    const ok = cli();
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/red/);
    expect(ran()).toBe(true);
  });
});
