import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { decide, type NormalizedEvent } from "../../companion/guard.js";

// B7 — shell 那道闸门是按「文件名」认引擎的：路径分隔符之前是什么目录一概不问，于是
// 磁盘上任何一个恰好叫 companion.mjs / ideas.ts / cli.ts 的文件都会被当成引擎本人启动。
// 第三轮补的是「名字只是后缀」（evilideas.ts、attacker-cli.ts），没有补「名字对、位置
// 随便」。配上「账本目录什么文件都收」，这两件事接起来就是一条完整的任意代码执行链：
// 先把脚本写进 ideas/，再 `node ideas/companion.mjs check` 让守卫替它开门。
//
// 引擎该按身份认，不是按拼写认：项目里安装的那一份 bundle（.companion/companion.mjs），
// 以及开发检出里的引擎源码（companion/dist/companion.mjs、companion/ideas.ts、
// companion/cli.ts）。把候选路径对着项目根目录解析出来，只有「就是那一个文件」才放行。
//
// 同一处顺带补一个易用性缺口：被认可的脚本只列了共同基座的安装器和打包入口，当时本仓库
// CLAUDE.md 教人用的那个旧安装器（claude-companion/install.ts）反倒被解释器墙拒掉。
// （2026-09-05 起 claude-companion/ 已删除，CLAUDE.md 不再提任何安装命令；白名单里这
// 两条旧入口留着，下面的用例锁的是白名单的形状。）
describe("companion guard engine identity, not spelling (B7)", () => {
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
      command: "npx vitest run tests/a.test.txt"
      test_files: [ tests/a.test.txt ]
      pass: "exit 0"
`;

  const shell = (command: string): NormalizedEvent => ({ event: "shell", command, cwd: dir });
  const denies = (commands: string[]) => {
    for (const command of commands) expect(decide(shell(command), dir).allow, command).toBe(false);
  };
  const allows = (commands: string[]) => {
    for (const command of commands) {
      const v = decide(shell(command), dir);
      expect(v.allow, `${command} —— ${v.reason ?? ""}`).toBe(true);
    }
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "engine-identity-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  // ── 名字对、位置不对 ≠ 引擎 ─────────────────────────────────────────────
  it("a file merely NAMED companion.mjs, in a directory of the attacker's choosing, is not the engine", () => {
    // 带空格的目录只用带引号的写法。不带引号时那个空格在真 shell 里就把路径切断了，
    // 命令根本不是「跑那个文件」—— 以前它被拒是解释器墙顺手拦的（I-144 拆掉了），
    // 拿它当「身份检查」的证据是假证据。身份这条性质由下面几行如实锁住。
    const spaced = mkdtempSync(join(tmpdir(), "not the engine-")).replaceAll("\\", "/");
    const elsewhere = mkdtempSync(join(tmpdir(), "not-the-engine-")).replaceAll("\\", "/");
    dirs.push(spaced, elsewhere);
    denies([
      `node "${spaced}/companion.mjs" check`,
      `node '${spaced}/companion.mjs' check`,
      `node ${elsewhere}/companion.mjs check`,
      `npx tsx ${elsewhere}/ideas.ts next`,
      `tsx ${elsewhere}/cli.ts status`,
    ]);
  });

  it("…including the writable ledger directory, which is the whole exploit", () => {
    // 账本目录（ideas/）任何文件都收得下，所以「按名字认引擎」＋「账本目录可写」
    // 合起来就是任意代码执行：写一个 ideas/companion.mjs，再让守卫把它当引擎跑。
    denies([
      "node ideas/companion.mjs check",
      "npx tsx ideas/ideas.ts check",
      "node src/tools/companion.mjs render",
      "npx tsx node_modules/.bin/cli.ts next",
    ]);
  });

  it("…and the deny says WHERE the engine actually is, so nobody is left baffled", () => {
    const v = decide(shell("node ideas/companion.mjs check"), dir);
    expect(v.allow).toBe(false);
    expect(v.reason, "得点出是位置不对，不是命令写错").toMatch(/位置/);
    expect(v.reason, "得把真正的引擎路径念给人听").toMatch(/\.companion\/companion\.mjs/);
    expect(v.reason, "得把被拒的那个路径原样引出来").toMatch(/ideas\/companion\.mjs/);
  });

  // ── 真的那一份，仍然照常跑 ───────────────────────────────────────────────
  it("the installed bundle and this checkout's engine sources ARE the engine", () => {
    const here = dir.replaceAll("\\", "/");
    allows([
      "node .companion/companion.mjs check",              // 安装进项目的那一份 bundle
      "node companion/dist/companion.mjs check",          // 开发检出里打出来的 bundle
      "npx tsx companion/ideas.ts show I-001",
      "tsx companion/cli.ts status --project .",
      "node ./companion/dist/companion.mjs next",
      "node companion\\dist\\companion.mjs check",
      `node "${here}/companion/dist/companion.mjs" check`, // 绝对路径指回项目里那一份
      `npx tsx "${here}/companion/ideas.ts" next`,
    ]);
  });

  // ── 三家自己的安装器 ────────────────────────────────────────────────────
  it("all three implementations' own install entry points run", () => {
    const here = dir.replaceAll("\\", "/");
    allows([
      "npx tsx companion/install.ts --status",
      "npx tsx companion/install.ts D:/GitHub/some-repo",
      "node companion/build.mjs",
      "npx tsx claude-companion/install.ts D:/GitHub/some-repo",   // 当时 CLAUDE.md 这样教
      "npx tsx claude-companion/install.ts --status",
      "npx tsx cursor-companion/install.ts D:/GitHub/some-repo",
      `npx tsx "${here}/claude-companion/install.ts" --update`,
    ]);
  });

  // I-144 起，「被认可的脚本」这个概念没有了：它只是解释器墙上的一个洞，墙拆了洞也就
  // 不存在了，任意脚本和安装器一样放行。上面那条用例锁的是安装器**还跑得起来**（那条
  // 性质没变），这条锁的是放宽本身 —— 别让它悄悄发生。引擎白名单是另一回事，仍然按
  // 身份认，见下一条 hook 入口的用例。
  it("…and an arbitrary script named install.ts or build.mjs runs too now (I-144)", () => {
    const elsewhere = mkdtempSync(join(tmpdir(), "not an installer-")).replaceAll("\\", "/");
    dirs.push(elsewhere);
    allows([
      "npx tsx scripts/install.ts",
      "node tools/build.mjs",
      "npx tsx ideas/install.ts --status",
      `npx tsx ${elsewhere}/install.ts --status`,
      `npx tsx "${elsewhere}/companion/install.ts" --status`,
      "npx tsx evilcompanion/install.ts --status",
      "node xcompanion/build.mjs",
    ]);
  });

  it("and the hook entry stays unreachable however the path is spelled", () => {
    denies([
      "node .companion/companion.mjs guard --platform=claude",
      "node companion/dist/companion.mjs guard --platform=cursor",
      "npx tsx companion/cli.ts guard --platform=codex",
    ]);
  });
});
