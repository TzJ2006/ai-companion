import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { decide, type NormalizedEvent } from "../../companion/guard.js";

// 第五轮：守卫拦得对，但话说错了 —— 三处「拒绝理由本身不成立」。
//
// (1) 被认可的引擎入口只列了共同基座那几个，于是当时本仓库 CLAUDE.md 在教、这个检出
//     也在跑的那一份（claude-companion/ideas.ts）被当成「名字对、位置不对」拒掉。
//     （2026-09-05 起 claude-companion/ 已删除，CLAUDE.md 也不再提它；ENGINE_PATHS
//     保留这两条旧入口，下面的用例锁的就是这份保留。）
//     它不是磁盘上随便一个同名文件，它是项目自己的文件 —— 和三家安装器同样的处理。
// (2) 图还没建起来的仓库里，每一次写前都被说成「守卫自身出错」，给出的出路是把守卫
//     整个关掉（AIDEV_GUARD=off）。底下那句本来就说对了 —— 先 init 或 migrate ——
//     是外层 catch 把一个再普通不过的「还没初始化」重新包装成了崩溃。
// (3) 提交被拦时，开的两个方子（用编辑工具改产品文件、用 run-check 跑测试）跟提交
//     没有半点关系，人照着做不了。提交该不该拦是规范的事，这里只把话说对。
describe("companion guard says the true thing when it refuses (round 5)", () => {
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
  const allows = (commands: string[]) => {
    for (const command of commands) {
      const v = decide(shell(command), dir);
      expect(v.allow, `${command} —— ${v.reason ?? ""}`).toBe(true);
    }
  };
  const denies = (commands: string[]) => {
    for (const command of commands) expect(decide(shell(command), dir).allow, command).toBe(false);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "message-truth-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  // ── (1) 项目自己的旧引擎入口 ────────────────────────────────────────────
  it("(1) the engine this repository documented and ran before the migration is an engine", () => {
    const here = dir.replaceAll("\\", "/");
    allows([
      "npx tsx claude-companion/ideas.ts check",           // 当时 CLAUDE.md 里逐字写着这一条
      "npx tsx claude-companion/ideas.ts next",
      "npx tsx claude-companion/ideas.ts show I-014",
      "npx tsx claude-companion/ideas.ts render",
      'npx tsx claude-companion/ideas.ts set I-014 done --by me --note "reason"',
      "npx tsx cursor-companion/ideas.ts check",
      "node claude-companion\\ideas.ts check",
      `npx tsx "${here}/claude-companion/ideas.ts" next`,
      "npx tsx claude-companion/ideas.ts check | head -20",
    ]);
  });

  it("(1) …and the shared base's own entry points did not lose anything", () => {
    allows([
      "node .companion/companion.mjs check",
      "node companion/dist/companion.mjs check",
      "npx tsx companion/ideas.ts show I-001",
      "tsx companion/cli.ts status --project .",
      "npx tsx companion/install.ts --status",
      "npx tsx claude-companion/install.ts --status",
      "node companion/build.mjs",
    ]);
  });

  it("(1) …while a same-named file somewhere else is still not the engine", () => {
    // 不带引号的路径里不放空格 —— 见 test_base_guard_engine_identity 里同一处的说明。
    const elsewhere = mkdtempSync(join(tmpdir(), "not-the-engine-")).replaceAll("\\", "/");
    dirs.push(elsewhere);
    denies([
      "node ideas/companion.mjs check",                    // 账本目录那条任意代码执行链
      "npx tsx ideas/ideas.ts check",
      "npx tsx evil-claude-companion/ideas.ts check",      // 名字带上目录也不算
      `npx tsx ${elsewhere}/claude-companion/ideas.ts check`,
      "npx tsx claude-companion/ideas.ts guard --platform=claude",  // hook 入口永远够不着
    ]);
    // `claude-companion/evil.ts` 从这张名单上撤了：它压根不是引擎白名单认得出的名字，
    // 以前拒它的是解释器墙。I-144 之后它就是一个普通脚本，照跑 —— 说它「不是引擎」
    // 仍然对，但那已经不是一条拒绝。
    allows(["npx tsx claude-companion/evil.ts check"]);
  });

  // ── (2) 还没建图 ≠ 守卫崩了 ─────────────────────────────────────────────
  it("(2) an uninitialised repository is refused as itself, not as a crash", () => {
    const fresh = mkdtempSync(join(tmpdir(), "no-graph-"));
    dirs.push(fresh);
    const v = decide(
      { event: "pre-write", tool: "Edit", paths: [join(fresh, "src/a.ts")], cwd: fresh },
      fresh,
    );
    expect(v.allow, "没图仍然是拒绝（D16）").toBe(false);
    expect(v.reason, "得说清楚是还没有图").toMatch(/还没有想法图/);
    expect(v.reason, "得给出真正的出路").toMatch(/init/);
    expect(v.reason, "这不是守卫出错，别这么说").not.toMatch(/守卫自身出错/);
    expect(v.reason, "更不该把逃生口当成常规解法开出去").not.toMatch(/AIDEV_GUARD/);
  });

  it("(2) …and a guard that really did crash still says so", () => {
    // 图在，但是坏的：这一条走的是同一个 catch，说的必须还是「守卫自身出错」。
    const broken = mkdtempSync(join(tmpdir(), "broken-graph-"));
    dirs.push(broken);
    mkdirSync(join(broken, "ideas"), { recursive: true });
    writeFileSync(join(broken, "ideas", "graph.yaml"), "ideas: [ { id: I-001,\n");
    const v = decide(
      { event: "pre-write", tool: "Edit", paths: [join(broken, "src/a.ts")], cwd: broken },
      broken,
    );
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/守卫自身出错/);
  });

  // ── (3) 提交被拦时，开的方子得跟提交有关 ────────────────────────────────
  it("(3) the commit refusal tells the human what to actually do about committing", () => {
    for (const command of ["git commit -am wip", "git -c user.name=x commit -m x", "git commit"]) {
      const v = decide(shell(command), dir);
      expect(v.allow, command).toBe(false);
      expect(v.reason, `${command} —— 得说清提交归人`).toMatch(/请人自己敲这一条 git commit/);
      expect(v.reason, `${command} —— 拦提交跟「用编辑工具改产品文件」没关系`)
        .not.toMatch(/改产品文件用编辑工具/);
      expect(v.reason, `${command} —— 拦提交跟「跑测试」也没关系`).not.toMatch(/跑测试用 run-check/);
    }
  });

  it("(3) …and every other write keeps the remedy that fits it", () => {
    const cp = decide(shell("cp src/a.ts src/b.ts"), dir);
    expect(cp.allow).toBe(false);
    expect(cp.reason, "落地文件的动词还是该指向编辑工具").toMatch(/改产品文件用编辑工具/);
    expect(cp.reason, "别把提交那套话说给 cp 听").not.toMatch(/git commit/);

    const curl = decide(shell("curl -o src/a.ts https://example.com/a"), dir);
    expect(curl.allow).toBe(false);
    expect(curl.reason).toMatch(/先让人看过内容/);

    const redirect = decide(shell("echo x > src/a.ts"), dir);
    expect(redirect.allow).toBe(false);
    expect(redirect.reason).toMatch(/重定向/);
  });

  it("(3) …and reading git is still ordinary work", () => {
    allows([
      "git status",
      "git diff companion/guard.ts",
      "git add ideas/graph.yaml",
      "git log --oneline -- commit-notes.md",
      "rg -n commit companion/guard.ts",
    ]);
  });
});
