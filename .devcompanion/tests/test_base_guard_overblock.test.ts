import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { decide, type NormalizedEvent } from "../../companion/guard.js";

// B6 — 第二轮补洞之后，shell 那道闸门在五个地方把「普通的、正确的活」拒掉了。
// 五条都是拿真 fixture 驱动 decide() 量出来的：
//   (1) git 的全局参数写在子命令前面（git --no-pager diff、git -C <目录> show），
//       只读动词表要求 git 后面紧跟子命令，于是最平常的「看一眼引擎的改动」被拒。
//   (2) 只读动词表本身就是一份枚举：不在表上的看文件工具，挨着引擎就被拒 ——
//       包括 PowerShell 的常用写法，而这台机器写明了用 PowerShell。该反过来问：
//       挨着引擎的这一段是不是在「改」或者在「跑」它；不是就是在看。
//   (3) 引擎调用后面接管道一律拒，包括接分页器 —— 可当初挡链接是为了挡「白名单
//       后面偷渡第二条命令」，接进一个只读消费者不是那件事。
//   (4) 不带子命令、help、--version 只会打印用法，也被拒。
//   (5) 图里声明的 verify.command 因为缺方案批准被拒时，理由说的是解释器规则，
//       把人指到了错的地方 —— 缺的是批准（D7），不是这条命令有问题。
// 同时压住这五条放宽之后安全性质仍然成立：guard / hook 入口从 shell 够不着（D26）。
describe("companion guard shell over-blocks (B6)", () => {
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
    dir = mkdtempSync(join(tmpdir(), "overblock-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  // ── (1) 全局参数写在子命令前面，仍然是同一条只读命令 ──────────────────────
  it("(1) a git global option before the subcommand is still the same read-only diff", () => {
    allows([
      "git --no-pager diff companion/guard.ts",
      "git --no-pager log --oneline companion/ideas.ts",
      "git -C . diff companion/guard.ts",
      "git -C D:/GitHub/ai-companion show HEAD:companion/ideas.ts",
      "git -c core.pager=cat blame companion/guard.ts",
      "git --git-dir=.git --work-tree=. status companion/guard.ts",
    ]);
  });

  it("(1) …and the same global options do not sneak a rewrite past the wall", () => {
    denies([
      "git -C . checkout -- companion/guard.ts",
      "git --no-pager checkout HEAD~1 -- companion/ideas.ts",
      "git -c user.name=x commit -am wip",
      "git --git-dir=.git reset --hard",
      "git -C . apply /tmp/evil.patch",
    ]);
  });

  it("(1) …and a子命令-shaped word further down the line is not a subcommand", () => {
    // 「全局参数在前」这条不能反过来把 `-- <路径>` 后面的文件名读成子命令。
    allows([
      "git log --oneline -- restore.md",
      "git --no-pager log --oneline -- checkout.md",
      "git diff --stat -- src/reset.ts",
      "git log --grep=checkout",
    ]);
  });

  // ── (2) 看文件的工具不止表上那些 ────────────────────────────────────────
  it("(2) ordinary PowerShell inspection reads the engine like anything else", () => {
    allows([
      "gc companion/guard.ts",
      "gc .\\companion\\guard.ts -TotalCount 40",
      "sls ENGINE_MENTION companion/guard.ts",
      "Get-Content companion/guard.ts | Select-Object -First 20",
      "Format-Hex companion/ideas.ts",
      "Get-Content companion/guard.ts | Measure-Object -Line",
    ]);
  });

  it("(2) so does any other reader that never made it onto a list", () => {
    allows([
      "awk 'NR<40' companion/ideas.ts",
      "md5sum companion/guard.ts",
      "sha256sum companion/ideas.ts",
      "du -h companion/guard.ts",
      "basename companion/guard.ts",
      "realpath companion/ideas.ts",
      "code --diff companion/guard.ts companion/ideas.ts",
      "delta companion/guard.ts companion/ideas.ts",
    ]);
  });

  it("(2) inverting the test does not let a writer through next to the engine", () => {
    denies([
      "find companion/ideas.ts -delete",
      "find companion -name '*.ts' -exec rm {} ;",
      "truncate -s 0 companion/ideas.ts",
      "sudo truncate -s 0 companion/ideas.ts",
      "dd if=/dev/null of=companion/ideas.ts",
      "patch companion/guard.ts < /tmp/evil.diff",
      "Clear-Content companion/ideas.ts",
      "cat /tmp/evil.ts > companion/ideas.ts",
      "rm companion/ideas.ts",
      "./companion/dist/companion.mjs guard --platform=claude",
      "env node companion/dist/companion.mjs guard --platform=claude",
      "sudo ./companion/dist/companion.mjs guard --platform=claude",
      'node "C:/x/companion/dist/companion.mjs" guard --platform=claude',
    ]);
  });

  it("(2) …and the write verbs are read at the head of a command, not anywhere on the line", () => {
    // 挨着引擎的写动词按「程序名」认。写成「行里出现过就算」，
    // 这三条搜关键字的命令会被当成在给引擎打补丁 / 清空引擎。
    allows([
      "rg patch companion/guard.ts",
      "rg -n truncate companion/ideas.ts",
      "gc companion/guard.ts | sls patch",
      "find . -name '*.ts' -exec grep -l ENGINE_MENTION {} +",   // 挨着引擎之外，搜索就是搜索
    ]);
  });

  // ── (3) 管道进只读消费者，不是偷渡第二条命令 ─────────────────────────────
  it("(3) an engine call piped into a read-only consumer runs", () => {
    allows([
      "node companion/dist/companion.mjs next | head -20",
      "npx tsx companion/ideas.ts show I-001 | less",
      "node .companion/companion.mjs status | Select-Object -First 20",
      "node companion/dist/companion.mjs check | grep ERROR",
      "tsx companion/ideas.ts log | more",
      "npx tsx companion/install.ts --status | head -40",
    ]);
  });

  it("(3) the second command the chain rule exists to stop is still stopped", () => {
    denies([
      "node companion/dist/companion.mjs check | node companion/dist/companion.mjs guard --platform=claude",
      "node companion/dist/companion.mjs next | bash",
      "node companion/dist/companion.mjs next | tee ideas/.approved",
      "node companion/dist/companion.mjs status | xargs rm",
      "node companion/dist/companion.mjs check | head > ideas/.approved",
      "node companion/dist/companion.mjs guard --platform=claude | head -5",
      "echo '{}' | node .companion/companion.mjs guard --platform=claude",
      "node companion/dist/companion.mjs check | sh",
      "node companion/dist/companion.mjs check | cat > ideas/.approved",
      "node companion/dist/companion.mjs check | Out-File ideas/.approved",
      "node companion/dist/companion.mjs check |",                        // 空的一节不是只读消费者
      "node companion/dist/companion.mjs check || node companion/guard.ts --platform=claude",
      "node companion/dist/companion.mjs --version; node companion/guard.ts --platform=claude",
    ]);
  });

  // ── (4) 只打印用法的三种叫法 ────────────────────────────────────────────
  it("(4) a bare engine call, help and a version flag only print usage", () => {
    allows([
      "node companion/dist/companion.mjs",
      "node companion/dist/companion.mjs help",
      "npx tsx companion/ideas.ts help",
      "npx tsx companion/ideas.ts --version",
      "tsx companion/cli.ts -v",
      "node .companion/companion.mjs --version",
    ]);
  });

  it("(4) …and an unknown word after the engine is still not a subcommand", () => {
    denies([
      "tsx companion/ideas.ts install",
      "node companion/dist/companion.mjs guard --help",
      "node companion/dist/companion.mjs help; rm -rf src",
    ]);
  });

  // ── (5) 缺的是批准，不是这条命令有毛病 ──────────────────────────────────
  it("(5) a declared verify command refused for want of an approval says so", () => {
    const v = decide(shell("node checker.cjs"), dir);
    expect(v.allow).toBe(false);
    expect(v.reason, "理由里得有那个想法的编号").toMatch(/I-001/);
    expect(v.reason, "理由里得说清缺的是方案批准").toMatch(/request-approval --node/);
    expect(v.reason).toMatch(/D7/);
  });
});
