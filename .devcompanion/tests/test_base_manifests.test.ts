import { describe, it, expect } from "vitest";
import { claudeHooks, cursorHooks, codexHooks, ENGINE_RELATIVE } from "../../companion/manifests.js";
import { normalizeClaude, normalizeCursor, normalizeCodex, decide, encodeClaude } from "../../companion/guard.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// I-097 — 三份只含 hook 接线的小清单，每家只写「哪个事件、调哪条命令」，命令都
// 指向同一个单文件产物。Claude 用 exec 形式加 ${CLAUDE_PROJECT_DIR} 占位符
// （官方对 Windows 的建议，也终结了「换台机器接线就断」的绝对路径问题）；
// Cursor 的关键拦截项 failClosed；Codex 的命令保持一行稳定字符串（信任绑定
// hook 定义哈希，产物更新不该触发重新信任）。裁决依据：D14/D15。
describe("companion platform manifests (I-097)", () => {
  const all = () => [claudeHooks(), cursorHooks(), codexHooks()] as const;

  it("no manifest carries an absolute path, a machine name, or an 'ask'", () => {
    for (const manifest of all()) {
      const text = JSON.stringify(manifest);
      expect(text).not.toMatch(/[A-Z]:[\\/]/);          // no drive letters
      expect(text).not.toMatch(/npx|tsx/);              // plain node only
      expect(text).not.toMatch(/"ask"/);
      expect(text).not.toMatch(/"\/[^"]/);              // no /rooted command
      expect(text).not.toMatch(/~[\\/]/);               // no home directory
      expect(text).not.toMatch(/\\\\\\\\/);             // no UNC \\server\share
    }
  });

  // 引擎路径中立（D14/D34）：只装 Cursor 或只装 Codex 的仓库不该为了一个跟
  // Claude 无关的文件长出 .claude/ 目录；而且这串路径只允许有一个出处，
  // 三份接线、安装器和五个技能都读同一个常量。
  it("the engine path is host-neutral and lives in exactly one constant", () => {
    expect(ENGINE_RELATIVE).toBe(".companion/companion.mjs");
    for (const host of [".claude/", ".cursor/", ".codex/"]) {
      expect(ENGINE_RELATIVE.startsWith(host), `引擎不该住在 ${host}`).toBe(false);
    }
  });

  // H3：命令不能假设进程的工作目录就是项目根。Codex 官方文档说 hook 命令用
  // 「会话 cwd」，并明确警告会话可能从子目录起 —— 那里相对路径就是
  // MODULE_NOT_FOUND、退出 1，而 Codex 把失败的 hook 当**非阻塞**，于是每一次
  // 写入都没人看着（D15：答不上来的门不能读作放行）。官方给的解法就是从 git
  // 根解析。Cursor 文档反过来保证「项目级 hook 从项目根运行」，所以根相对路径
  // 本身就是锚点 —— 但必须写成 `.companion/…` 而不是 `./…`（文档原话的要求）。
  it("no manifest command assumes the working directory is the project root", () => {
    const claudeText = JSON.stringify(claudeHooks());
    for (const piece of claudeText.match(new RegExp(`[^"]*${ENGINE_RELATIVE}`, "g")) ?? []) {
      expect(piece, piece).toContain("${CLAUDE_PROJECT_DIR}/");
    }

    const cursor = cursorHooks();
    for (const entries of Object.values(cursor.hooks) as { command: string }[][]) {
      for (const entry of entries) {
        expect(entry.command, entry.command).toContain(` ${ENGINE_RELATIVE} `);
        expect(entry.command, "Cursor 文档要求根相对，不写 ./").not.toContain("./");
      }
    }

    const codex = codexHooks() as { hooks: Record<string, { hooks: { command: string; commandWindows?: string }[] }[]> };
    const codexHookEntries = Object.values(codex.hooks).flat().flatMap((g) => g.hooks);
    for (const entry of codexHookEntries) {
      // POSIX：官方文档给的就是 $(git rev-parse --show-toplevel)；|| pwd 让没有
      // git 的检出退回今天的行为，而不是指到文件系统根。
      expect(entry.command).toContain("git rev-parse --show-toplevel");
      expect(entry.command).toMatch(/\|\|\s*pwd/);
      expect(entry.command).not.toMatch(new RegExp(`node\\s+${ENGINE_RELATIVE.replaceAll(".", "\\.")}`));
      // cmd.exe 没有 $(…)，会把它当字面量 —— 所以 Windows 走 Codex 自己的
      // commandWindows 覆盖，同样锚在 git 根上。
      expect(entry.commandWindows, "Codex 在 Windows 上必须有自己的命令").toBeTruthy();
      expect(entry.commandWindows).not.toContain("$(");
      expect(entry.commandWindows).toContain("git rev-parse --show-toplevel");
    }
    // 信任绑定 hook 定义的哈希：两条命令串都必须全局唯一，产物更新不该触发重新信任。
    expect(new Set(codexHookEntries.map((h) => h.commandWindows)).size).toBe(1);
  });

  it("claude: the four guard events plus SessionStart, exec form, placeholder path", () => {
    const hooks = claudeHooks() as Record<string, { matcher?: string; hooks: { command: string; args?: string[]; timeout?: number }[] }[]>;
    for (const event of ["PreToolUse", "PostToolUse", "UserPromptSubmit", "Stop", "SessionStart"]) {
      expect(Object.keys(hooks), event).toContain(event);
    }
    const text = JSON.stringify(hooks);
    expect(text).toContain("${CLAUDE_PROJECT_DIR}");
    // exec form: command is the executable, the path travels in args
    for (const group of hooks["PreToolUse"]) {
      for (const h of group.hooks) {
        expect(h.command).toBe("node");
        expect(h.args?.join(" ")).toContain(ENGINE_RELATIVE);
      }
    }
    // shell commands are gated too, and Windows without git-bash speaks PowerShell
    // （名字挨不挨着由下面那个 describe 里的构造决定，这里只问「在不在」）
    const matchers = hooks["PreToolUse"].map((g) => g.matcher ?? "").join("|").split("|");
    for (const tool of ["Bash", "PowerShell"]) expect(matchers, tool).toContain(tool);
    expect(matchers.join("|")).toMatch(/mcp__/);
    // the 30-second UserPromptSubmit trap: an explicit, larger timeout
    const upsHooks = hooks["UserPromptSubmit"][0].hooks[0];
    expect(upsHooks.timeout ?? 0).toBeGreaterThanOrEqual(60);
  });

  it("cursor: version 1, native events, failClosed on the blocking ones, relative commands", () => {
    const manifest = cursorHooks() as { version: number; hooks: Record<string, { command: string; failClosed?: boolean }[]> };
    expect(manifest.version).toBe(1);
    for (const event of ["preToolUse", "beforeShellExecution", "beforeMCPExecution", "afterFileEdit", "beforeSubmitPrompt", "stop", "sessionStart"]) {
      expect(Object.keys(manifest.hooks), event).toContain(event);
    }
    for (const event of ["preToolUse", "beforeShellExecution", "beforeMCPExecution"]) {
      for (const entry of manifest.hooks[event]) {
        expect(entry.failClosed, `${event} 必须 failClosed`).toBe(true);
      }
    }
    for (const entries of Object.values(manifest.hooks)) {
      for (const entry of entries) {
        expect(entry.command.startsWith("node ")).toBe(true);
        expect(entry.command).toContain(ENGINE_RELATIVE);
        expect(entry.command).toContain("--platform=cursor");
      }
    }
  });

  it("codex: claude-shaped events, matcher covers apply_patch and mcp, one stable command string", () => {
    const manifest = codexHooks() as { hooks: Record<string, { matcher?: string; hooks: { command: string }[] }[]> };
    for (const event of ["PreToolUse", "PostToolUse", "UserPromptSubmit", "Stop"]) {
      expect(Object.keys(manifest.hooks), event).toContain(event);
    }
    const pre = manifest.hooks["PreToolUse"][0];
    expect(pre.matcher).toMatch(/apply_patch/);
    expect(pre.matcher).toMatch(/mcp__/);

    const commands = Object.values(manifest.hooks)
      .flat().flatMap((g) => g.hooks.map((h) => h.command));
    expect(new Set(commands).size).toBe(1);             // 信任哈希稳定：一条命令走天下
    expect(commands[0]).toContain("--platform=codex");
  });
});

// 归一化器认得的工具名，接线必须真的订阅得到 —— 否则守卫写得再对也没人调它。
// 上一轮守卫学会了 Codex 的 shell / local_shell，可 codexHooks() 的 matcher 还是
// ^(Bash|apply_patch|Edit|Write|mcp__.*)$：真装到 Codex 上，那些事件根本不进守卫，
// 而 Codex 把「没答话的 hook」算成失败但**非阻塞**，等于放行（D15）。Claude 那边
// 同理，matcher 只写了 Bash|PowerShell。
// 所以这里不比字符串：把三家真会发的工具名喂给它们自己的归一化器，凡是被判成
// shell / read / pre-write / post-write 的名字，都必须被那家 host 该事件的 matcher
// 命中（D22 —— 一种事件、一张规则表；接线漏一个名字，这张表就够不着）。
// 反向也测：守卫没有规则的只读工具不该被拉进来，闸门只该落在该落的地方。
describe("manifest matchers subscribe every tool name the normalizers classify (D15/D22)", () => {
  type Raw = Parameters<typeof normalizeClaude>[0];
  interface Candidate { tool: string; input: Record<string, unknown> }

  const SHELL_IN = { command: "Remove-Item src/a.ts" };
  const FILE_IN = { file_path: "src/a.ts", content: "x" };
  const CURSOR_FILE_IN = { path: "src/a.ts", content: "x" };
  const PATCH_IN = { command: "*** Begin Patch\n*** Update File: src/a.ts\n@@\n+x\n*** End Patch" };

  const each = (tools: string[], input: Record<string, unknown>): Candidate[] =>
    tools.map((tool) => ({ tool, input }));

  // 每家 host 真会发的工具名，配上它自己那套 tool_input 拼法。工具名的大小写也列了：
  // 守卫查表前先 toLowerCase（Cursor 那张表更是直接带 /i），所以 `shell` 和 `Shell`
  // 在守卫眼里是同一个工具，接线也必须同样认得。
  const CANDIDATES: Record<string, Candidate[]> = {
    claude: [
      ...each(["Bash", "bash", "PowerShell", "powershell", "pwsh", "shell", "local_shell"], SHELL_IN),
      ...each(["Edit", "Write", "NotebookEdit"], FILE_IN),
      ...each(["Read", "read", "read_file", "readfile"], FILE_IN),
      ...each(["mcp__fs__write_file"], FILE_IN),
    ],
    cursor: [
      ...each(["Write", "write", "StrReplace", "Delete", "EditNotebook", "ApplyPatch", "search_replace"], CURSOR_FILE_IN),
      ...each(["mcp__fs__write_file", "MCP:fs__write_file"], CURSOR_FILE_IN),
    ],
    codex: [
      ...each(["Bash", "bash", "PowerShell", "powershell", "pwsh", "shell", "local_shell"], SHELL_IN),
      ...each(["Edit", "Write"], FILE_IN),
      ...each(["Read", "read", "read_file", "readfile"], FILE_IN),
      ...each(["apply_patch"], PATCH_IN),
      ...each(["mcp__fs__write_file"], FILE_IN),
    ],
  };

  /** 没写 matcher 的条目是「这个事件全收」。 */
  const matchersOf = (groups: { matcher?: string }[] | undefined) =>
    (groups ?? []).map((g) => g.matcher ?? ".*");
  const hits = (matchers: string[], tool: string) => matchers.some((m) => new RegExp(m).test(tool));
  /** 守卫真的会看的四种事件；其余归一成 other，本来就不必订阅。 */
  const GUARDED = new Set(["shell", "read", "pre-write", "post-write"]);

  const claude = claudeHooks() as Record<string, { matcher?: string }[]>;
  const cursor = cursorHooks().hooks as Record<string, { matcher?: string }[]>;
  const codex = codexHooks().hooks as Record<string, { matcher?: string }[]>;

  const WIRINGS = [
    { host: "claude", event: "PreToolUse", normalize: normalizeClaude, matchers: matchersOf(claude["PreToolUse"]), candidates: CANDIDATES.claude },
    { host: "claude", event: "PostToolUse", normalize: normalizeClaude, matchers: matchersOf(claude["PostToolUse"]), candidates: CANDIDATES.claude },
    { host: "cursor", event: "preToolUse", normalize: normalizeCursor, matchers: matchersOf(cursor["preToolUse"]), candidates: CANDIDATES.cursor },
    { host: "codex", event: "PreToolUse", normalize: normalizeCodex, matchers: matchersOf(codex["PreToolUse"]), candidates: CANDIDATES.codex },
    { host: "codex", event: "PostToolUse", normalize: normalizeCodex, matchers: matchersOf(codex["PostToolUse"]), candidates: CANDIDATES.codex },
  ] as const;

  for (const { host, event, normalize, matchers, candidates } of WIRINGS) {
    it(`${host} ${event}: every tool name the normalizer classifies is subscribed`, () => {
      const missed: string[] = [];
      for (const { tool, input } of candidates) {
        const raw = { hook_event_name: event, tool_name: tool, tool_input: input, cwd: "." } as Raw;
        const kind = normalize(raw).event;
        if (!GUARDED.has(kind)) continue;               // 归一成 other 的名字不必订阅
        if (!hits(matchers, tool)) missed.push(`${tool} → ${kind}`);
      }
      expect(missed, `${host} 的 ${event} matcher 漏了守卫认得的工具名，装出去等于没接：${missed.join("、")}`).toEqual([]);
    });

    it(`${host} ${event}: tools the guard has no rule for stay unsubscribed`, () => {
      for (const tool of ["Grep", "Glob", "WebFetch", "WebSearch", "Task"]) {
        expect(hits(matchers, tool), `${host}/${event} 不该把只读的 ${tool} 也拉进守卫`).toBe(false);
      }
      expect(matchers, "全收 matcher 会让每一次工具调用都过一遍守卫").not.toContain(".*");
    });
  }

  // 订阅面变宽 ≠ 多拦一手：新接上的工具名走的还是同一张规则表（D22）。日常那几条
  // 命令必须照跑，只有 D21 认定的写文件招数才落闸 —— 不然这个洞是补上了，代价是
  // 把正常的活儿也堵死。
  it("the newly subscribed tool names still let ordinary work through", () => {
    const nowhere = join(tmpdir(), "companion-manifest-probe-no-graph");
    const verdict = (raw: Parameters<typeof normalizeCodex>[0], who = normalizeCodex) =>
      decide(who(raw), nowhere);

    for (const [tool, command] of [
      ["local_shell", "npx vitest run .devcompanion/tests/test_base_manifests.test.ts"],
      ["shell", "node .companion/companion.mjs check"],
      ["shell", "git status"],
    ] as const) {
      const v = verdict({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: { command }, cwd: nowhere });
      expect(v.allow, `${tool}: ${command} —— ${v.reason ?? ""}`).toBe(true);
    }
    expect(verdict({
      hook_event_name: "PreToolUse", tool_name: "pwsh",
      tool_input: { command: "Get-ChildItem src" }, cwd: nowhere,
    }, normalizeClaude).allow).toBe(true);

    // 闸还在：同一个新订阅上的工具名，写文件的招数照拦（D21）。
    const blocked = verdict({
      hook_event_name: "PreToolUse", tool_name: "local_shell",
      tool_input: { command: "echo x > src/a.ts" }, cwd: nowhere,
    });
    expect(blocked.allow).toBe(false);
    expect(blocked.reason).toMatch(/D21/);
  });
});

// 会话开场的那一条接线，三家必须走同一条路。上一轮给守卫加了 session 事件，
// Cursor 和 Codex 都改成打守卫了，Claude 这条却还直接调引擎的 status 子命令 ——
// 于是同一份简报有两条来路，只有两家经过那道门（D14/D22：一种事件、一张规则表）。
// 绕过去的那条还顺手把 D9 的方向丢了：引擎入口自己 catch，产物入口 cli.ts 没有，
// 没有图的仓库一开会话就当着人的面吐一段 node 栈。
describe("session start is wired through the guard on all three hosts (D14/D22)", () => {
  const ROOT = resolve(fileURLToPath(import.meta.url), "../../..");

  /** 一条 hook 条目真正会跑的命令行：Claude 拆成 command + args，Cursor/Codex 整
   *  行塞在 command 里，Codex 在 Windows 上还多一条 commandWindows。 */
  const commandLines = (node: unknown, out: string[] = []): string[] => {
    if (Array.isArray(node)) { for (const item of node) commandLines(item, out); return out; }
    if (node === null || typeof node !== "object") return out;
    const record = node as Record<string, unknown>;
    const args = Array.isArray(record.args) ? record.args : [];
    for (const [key, value] of Object.entries(record)) {
      if (key.startsWith("command") && typeof value === "string") out.push([value, ...args].join(" "));
      commandLines(value, out);
    }
    return out;
  };

  it("no wired event calls the engine directly — every command is the guard", () => {
    for (const [host, manifest] of [
      ["claude", claudeHooks()], ["cursor", cursorHooks()], ["codex", codexHooks()],
    ] as const) {
      const lines = commandLines(manifest);
      expect(lines.length, `${host} 一条接线都没有？`).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line, `${host} 有一条接线绕开了守卫：${line}`).toContain(" guard ");
        expect(line, `${host}：${line}`).toContain(`--platform=${host}`);
      }
    }
  });

  // 走守卫不等于多一道闸：session 事件在规则表里就是放行加一段文字，
  // 开会话永远不该是那件失败的事。
  it("routing session start through the guard still opens the session", () => {
    const nowhere = join(tmpdir(), "companion-manifest-probe-no-graph");
    const event = normalizeClaude({ hook_event_name: "SessionStart", cwd: nowhere });
    const verdict = decide(event, nowhere);
    expect(verdict.allow, verdict.reason ?? "").toBe(true);
    expect(encodeClaude(event, verdict).exitCode).toBe(0);
  });

  // D9 —— 钩子崩了要按裁决的方向崩，不是把 node 的栈打给人看。引擎自己的入口
  // 早就 catch 了，产物入口 cli.ts 没有，同一个命令两种脸。
  // 断言里不放子进程的 stderr 原文：那段文字里带着 `    at …(…ideas.ts:83:11)`，
  // vitest 会把它当成自己的调用栈去解析，于是真正的失败被一个 sourcemap 报错顶掉。
  const stackFrames = (text: string) => text.split(/\r?\n/).filter((l) => /^\s+at /.test(l)).length;

  it("the bundle entry fails like the engine entry: one line, no stack trace", { timeout: 120_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "companion-cli-nograph-"));
    try {
      const run = (entry: string) => spawnSync(
        process.execPath, ["--import", "tsx", join(ROOT, "companion", entry), "status", "--project", dir],
        { encoding: "utf8", cwd: ROOT, timeout: 120_000 });
      const engine = run("ideas.ts");
      const bundle = run("cli.ts");

      expect(engine.status, "引擎入口对着没有图的仓库就是 exit 1").toBe(1);
      expect(bundle.status, "产物入口的退出码要跟引擎入口一样").toBe(1);
      expect(engine.stderr.trim().length, "该说的那句话还是要说").toBeGreaterThan(0);
      expect(bundle.stderr.trim() === engine.stderr.trim(),
        "同一个失败，两个入口该说同一句话").toBe(true);
      expect(stackFrames(engine.stderr), "引擎入口本来就不打栈").toBe(0);
      expect(stackFrames(bundle.stderr), "产物入口把 node 的调用栈打给人看了（D9）").toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
