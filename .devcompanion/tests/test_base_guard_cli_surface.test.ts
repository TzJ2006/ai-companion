import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { decide, type NormalizedEvent } from "../../companion/guard.js";
import { SUBCOMMANDS } from "../../companion/ideas.js";

// 守卫那道 shell 闸门（D21）用一份子命令白名单决定放行哪些引擎调用，而这份白名单
// 曾经是手抄的第二份命令面：引擎的 SUBCOMMANDS 有十七条，守卫只抄了十六条，漏的
// 正是 `log`。于是引擎自己的命令被守卫拒掉，连引擎自己那句「旧图只想看看：check /
// next / show / log … 加 --file 照常可用」的提示，照做也会撞墙。同一条正则还有两个
// 口子：它只认 `npx tsx` 和 `node` 开头，本仓库脚本用的裸 `tsx` 被拒；`--help` 因为
// 不在子命令表里也被拒。命令面只能有一个出处（D11/D28），所以这里既压「放行什么」
// 也压「白名单是从引擎读来的，不是抄来的」。
describe("companion guard engine command surface (D11/D28)", () => {
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
    verify:
      command: "node checker.cjs"
      test_files: [ tests/a.test.txt ]
      pass: "exit 0"
`;

  const shell = (command: string): NormalizedEvent => ({ event: "shell", command, cwd: dir });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cli-surface-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  it("每一条引擎子命令都放行 —— 白名单和引擎不许再各写一份", () => {
    for (const [name] of SUBCOMMANDS) {
      const v = decide(shell(`node companion/dist/companion.mjs ${name}`), dir);
      expect(v.allow, `引擎有 ${name}，守卫却拦下了它`).toBe(true);
    }
  });

  it("log 就是那条漏掉的命令，引擎自己教人怎么跑它", () => {
    for (const command of [
      "node companion/dist/companion.mjs log",
      "node companion/dist/companion.mjs log I-001 --n 5",
      "npx tsx companion/ideas.ts log I-001",
      // 引擎在「旧图被 --file 指着」时打的那句提示，照抄下来就该能跑。
      "npx tsx companion/ideas.ts log --file ideas/graph.cursor.yaml",
    ]) {
      expect(decide(shell(command), dir).allow, command).toBe(true);
    }
  });

  it("裸 tsx 也是本仓库的启动方式，和 npx tsx / node 同等", () => {
    for (const command of [
      "tsx companion/ideas.ts check",
      "tsx companion/ideas.ts show I-001",
      "tsx companion/cli.ts status --project .",
    ]) {
      expect(decide(shell(command), dir).allow, command).toBe(true);
    }
  });

  it("--help 只会打印用法，拦它没有保护任何东西", () => {
    for (const command of [
      "node companion/dist/companion.mjs --help",
      "npx tsx companion/ideas.ts --help",
      "tsx companion/ideas.ts -h",
    ]) {
      expect(decide(shell(command), dir).allow, command).toBe(true);
    }
  });

  it("guard / hook 入口照旧够不着 —— D26 靠的就是这条", () => {
    for (const command of [
      "node companion/dist/companion.mjs guard --platform=claude",
      "npx tsx companion/guard.ts --platform=codex",
      "tsx companion/guard.ts --platform=cursor",
      "npx tsx companion/cli.ts guard --platform=claude",
      "tsx companion/cli.ts guard",
      "node companion/dist/companion.mjs guard --help",
      "echo '{}' | tsx companion/guard.ts --platform=claude",
      "tsx companion/ideas.ts check\ntsx companion/guard.ts --platform=claude",
    ]) {
      const v = decide(shell(command), dir);
      expect(v.allow, command).toBe(false);
    }
  });

  it("放宽的只是引擎调用本身：夹带的第二条命令、管道和重定向仍然拒", () => {
    for (const command of [
      "tsx companion/ideas.ts log > ideas/.approved",
      "node companion/dist/companion.mjs log | tee ideas/.approved",
      "tsx companion/ideas.ts --help; rm -rf src",
      "node companion/dist/companion.mjs log $(cat ideas/.approved)",
      "tsx companion/ideas.ts install",     // 不是子命令：安装器不从这条路进来
    ]) {
      expect(decide(shell(command), dir).allow, command).toBe(false);
    }
  });
});
