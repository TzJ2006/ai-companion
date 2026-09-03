import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { decide, type NormalizedEvent } from "../../companion/guard.js";

// B5 — shell 那道墙上还有三个量出来的口子，两开一闭：
//   (a) INTERPRETER 认的是「几种写法」，不是「把代码交给解释器」这件事：--eval /
//       --print / -p 这些长短写法、没有扩展名的脚本、powershell 的 base64
//       (-enc)、先吃一个子命令再吃脚本的运行时（deno run / bun run）全都走得过去。
//   (b) 引擎白名单和被认可的脚本是按文件名「后缀」匹配的，名字前面不要求路径分隔
//       符 —— 于是磁盘上任何一个名字恰好以引擎文件名结尾的脚本（evilideas.ts、
//       /tmp/attacker-cli.ts）都被当成引擎本人启动。
//   (c) 同两条正则的反面：脚本路径必须不带引号，于是加引号被拒；目录名里带空格的
//       检出（D:/My Repo/…）根本没有能跑起来的写法 —— 带引号不认，不带引号更不认。
describe("companion guard shell wall (B5)", () => {
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

  // 目录名里带空格的检出。它必须是「项目」本身：引擎按身份认（B7），别人检出里那份
  // 同名文件不是这个项目的引擎，所以这条性质只有在带空格的目录就是项目根时才成立。
  let spaced: string;

  const shell = (command: string): NormalizedEvent => ({ event: "shell", command, cwd: dir });
  const denies = (commands: string[]) => {
    for (const command of commands) expect(decide(shell(command), dir).allow, command).toBe(false);
  };
  const allowsIn = (project: string, commands: string[]) => {
    for (const command of commands) {
      const v = decide({ event: "shell", command, cwd: project }, project);
      expect(v.allow, `${command} —— ${v.reason ?? ""}`).toBe(true);
    }
  };
  const allows = (commands: string[]) => allowsIn(dir, commands);
  const fixture = (root: string) => {
    dirs.push(root);
    mkdirSync(join(root, "ideas"), { recursive: true });
    writeFileSync(join(root, "ideas", "graph.yaml"), yaml);
    return root;
  };

  beforeEach(() => {
    dir = fixture(mkdtempSync(join(tmpdir(), "shell-wall-")));
    spaced = fixture(mkdtempSync(join(tmpdir(), "My Repo-")));
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  // ── (a) 交给解释器这件事，不管写成什么样 ────────────────────────────────
  it("(a) the long eval and print flags run code exactly like -c and -e", () => {
    denies([
      `node --eval "require('fs').writeFileSync('src/a.ts','x')"`,
      `node --print "require('fs').readFileSync('ideas/.approved','utf8')"`,
      `node -p "require('fs').readFileSync('ideas/.approved','utf8')"`,
      `python --command "open('src/a.ts','w').write('x')"`,
    ]);
  });

  it("(a) a script with no extension is still a script", () => {
    denies([
      "bash setup",
      "sh ./ci/deploy",
      "python ./scripts/patch",
      "node ./tools/run",
    ]);
  });

  it("(a) powershell's base64 command is a command", () => {
    denies([
      "powershell -enc SQBuAHYAbwBrAGUA",
      "pwsh -nop -w hidden -ec SQBuAHYAbwBrAGUA",
      "powershell -EncodedCommand SQBuAHYAbwBrAGUA",
    ]);
  });

  it("(a) a runtime that takes a subcommand before the script is still a runtime", () => {
    denies([
      "deno run --allow-write scripts/patch.ts",
      "deno eval \"Deno.writeTextFileSync('src/a.ts','x')\"",
      "bun run scripts/patch.ts",
      "bun scripts/patch",
    ]);
  });

  // ── (b) 名字以引擎文件名结尾 ≠ 引擎 ──────────────────────────────────────
  it("(b) a script whose file name merely ends in the engine's is not the engine", () => {
    denies([
      "node evilideas.ts check",
      "npx tsx /tmp/attacker-cli.ts check",
      "tsx notideas.ts next",
      "node my-companion.mjs render",
      "node /tmp/steal-companion.mjs status",
      // 被认可的安装器/打包入口那一条本来就要求 `companion/` 是一整段目录名，这两
      // 行改动前后都拒 —— 摆在这里是为了以后加引号的写法也别把这段路放松掉。
      "npx tsx evilcompanion/install.ts --status",
      "node xcompanion/build.mjs",
      // B7：名字对、位置不对也不是引擎 —— 别的检出里那一份是别人的文件，不是这个
      // 项目的引擎；账本目录里那一份更是攻击者自己写进去的。
      "node D:/GitHub/ai-companion/companion/build.mjs",
      "node ideas/companion.mjs check",
    ]);
  });

  // ── (c) 带引号的路径就是路径 ────────────────────────────────────────────
  it("(c) a quoted engine path runs, and so does a checkout whose directory has a space", () => {
    const here = spaced.replaceAll("\\", "/");
    allows([
      'node "companion/dist/companion.mjs" check',
      "node 'companion/dist/companion.mjs' check",
      'npx tsx "companion/ideas.ts" show I-001',
    ]);
    allowsIn(spaced, [
      `node "${here}/companion/dist/companion.mjs" check --project "${here}"`,
      `node '${here}/companion/dist/companion.mjs' next`,
    ]);
  });

  it("(c) the sanctioned installer and build take a quoted path too", () => {
    const here = spaced.replaceAll("\\", "/");
    allows(['npx tsx "companion/install.ts" --status']);
    allowsIn(spaced, [
      `npx tsx "${here}/companion/install.ts" --update`,
      `node "${here}/companion/build.mjs"`,
    ]);
  });

  // ── 没有堵过头 ──────────────────────────────────────────────────────────
  it("the ordinary unquoted engine call, the installer, the build and plain reading still run", () => {
    allows([
      `node ${dir.replaceAll("\\", "/")}/companion/build.mjs`,     // 绝对路径指回项目自己那一份
      "node companion/dist/companion.mjs check",
      "node companion/dist/companion.mjs check --project .",
      "node companion\\dist\\companion.mjs check",
      "npx tsx companion/ideas.ts show I-001",
      "tsx companion/cli.ts status --project .",
      "npx tsx companion/install.ts D:/GitHub/some-repo",
      "npx tsx companion/install.ts --status",
      "node companion/build.mjs",
      "npx vitest run .devcompanion/tests/test_base_guard_shell_wall.test.ts",
      "npx vitest run tests/a.test.txt",              // 图里声明的验证命令
      "git diff companion/guard.ts",
      'rg -n "node" companion/guard.ts',
      "node --version",
      "python3 --version",
      "deno --version",
      "pwsh -Version",
      "git status",
      "ps aux | grep node",
      "which node",
      "ls node_modules",
      "npm run build",
      "ls | wc -l",
    ]);
  });
});
