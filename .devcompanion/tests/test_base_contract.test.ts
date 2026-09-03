import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  load, graphPath, paths, requestApproval, applyApproval, runCheck,
} from "../../companion/ideas.js";
import {
  normalizeClaude, normalizeCursor, normalizeCodex,
  decide, record, handlePrompt, type NormalizedEvent,
} from "../../companion/guard.js";

// H6 —— 统一的整个承诺就一句话：同一件事，三家同判。可这件事此前只有一个场景
// 在测（越界写被拒），而且只断言了 allow。这里把它做成一张契约表：每一行一个
// 场景，三列是三家 host 真正会发出来的原始 hook 载荷；逐行断言
//   (1) 归一化后的事件除了「工具名」和「工作目录」之外一模一样（D22）；
//   (2) decide 的 allow 一致，理由一字不差。
// 某一家真的发不出这个事件的格子明写 n/a 并说明原因 —— 缺口要看得见，不许靠少写
// 一列悄悄糊过去。

type Raw = Parameters<typeof normalizeClaude>[0];

/** A cell the host genuinely cannot deliver. Spelled out with its reason: a
 *  silently missing column is exactly how a platform gap stops being visible. */
interface NotApplicable { na: string }
type Cell = Raw | NotApplicable;
const na = (why: string): NotApplicable => ({ na: why });
const isNA = (cell: Cell): cell is NotApplicable => "na" in cell;

interface Built {
  /** Runs against the fresh fixture before anything is normalized. */
  setup?: () => void;
  verdict: { allow: boolean; reason?: RegExp };
  claude: Cell;
  cursor: Cell;
  codex: Cell;
}
interface Row { name: string; build: (dir: string) => Built }

/** The event minus the two fields the contract deliberately excuses: the tool
 *  NAME is each host's own vocabulary, and cwd is each host's own reported
 *  directory. Everything else has to match key for key (D22). */
function shape(event: NormalizedEvent): Record<string, unknown> {
  const { tool: _tool, cwd: _cwd, ...rest } = event;
  return rest;
}

const YAML = `version: 1
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
  - id: I-002
    name: "等人验收的想法"
    status: todo
    needs: [I-001]
    what: W2
    why: Y2
    expected: E2
    how: H2
    why_this_way: T2
    future: F2
    code:
      - file: src/b.ts
    verify:
      manual: "亲眼看一遍"
      signed_off: null
`;

// 这张表就是 D22 允诺的那组 fixture：一行一个场景，一列一家 host。
const TABLE: Row[] = [
  {
    name: "unclaimed product write",
    build: (dir) => ({
      verdict: { allow: false, reason: /D16/ },
      claude: { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "src/x.ts", content: "x" }, cwd: dir },
      cursor: { hook_event_name: "preToolUse", tool_name: "Write", tool_input: { path: "src/x.ts", content: "x" }, cwd: dir },
      codex: { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "src/x.ts", content: "x" }, cwd: dir },
    }),
  },
  {
    name: "claimed product write by a ready doing idea",
    build: (dir) => ({
      setup: () => {
        const { challenge } = requestApproval(dir, load(graphPath(dir)).graph, "plan", ["I-001"]);
        applyApproval(dir, `批准 ${challenge}`, { date: "2026-09-02" });
        runCheck(dir, load(graphPath(dir)).graph, "I-001", "red");
      },
      verdict: { allow: true },
      claude: { hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "src/a.ts", old_string: "// not yet", new_string: "export const a = 1;" }, cwd: dir },
      cursor: { hook_event_name: "preToolUse", tool_name: "StrReplace", tool_input: { path: "src/a.ts", old_string: "// not yet", new_string: "export const a = 1;" }, cwd: dir },
      codex: { hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "src/a.ts", old_string: "// not yet", new_string: "export const a = 1;" }, cwd: dir },
    }),
  },
  {
    name: "graph status flip",
    build: (dir) => ({
      verdict: { allow: false, reason: /set/ },
      claude: { hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "ideas/graph.yaml", old_string: "status: todo", new_string: "status: done" }, cwd: dir },
      cursor: { hook_event_name: "preToolUse", tool_name: "StrReplace", tool_input: { path: "ideas/graph.yaml", old_string: "status: todo", new_string: "status: done" }, cwd: dir },
      codex: { hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "ideas/graph.yaml", old_string: "status: todo", new_string: "status: done" }, cwd: dir },
    }),
  },
  {
    name: "graph prose edit",
    build: (dir) => ({
      verdict: { allow: true },
      claude: { hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "ideas/graph.yaml", old_string: "how: H2", new_string: "how: 换个说法写清楚做法" }, cwd: dir },
      cursor: { hook_event_name: "preToolUse", tool_name: "StrReplace", tool_input: { path: "ideas/graph.yaml", old_string: "how: H2", new_string: "how: 换个说法写清楚做法" }, cwd: dir },
      codex: { hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "ideas/graph.yaml", old_string: "how: H2", new_string: "how: 换个说法写清楚做法" }, cwd: dir },
    }),
  },
  {
    name: "protected evidence write",
    build: (dir) => ({
      verdict: { allow: false, reason: /D24/ },
      claude: { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "ideas/.approved", content: "批准" }, cwd: dir },
      cursor: { hook_event_name: "preToolUse", tool_name: "Write", tool_input: { path: "ideas/.approved", content: "批准" }, cwd: dir },
      codex: { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "ideas/.approved", content: "批准" }, cwd: dir },
    }),
  },
  {
    name: "mutating shell command",
    build: (dir) => ({
      verdict: { allow: false, reason: /D21/ },
      // Claude 注册的是 Bash|PowerShell，Codex 的 PreToolUse matcher 里也是 Bash；
      // Cursor 的 shell 走自己那条 beforeShellExecution，命令在顶层字段上。
      claude: { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "echo hacked > src/a.ts" }, cwd: dir },
      cursor: { hook_event_name: "beforeShellExecution", command: "echo hacked > src/a.ts", cwd: dir },
      codex: { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "echo hacked > src/a.ts" }, cwd: dir },
    }),
  },
  {
    name: "sanctioned engine command",
    build: (dir) => ({
      verdict: { allow: true },
      claude: { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "node companion/dist/companion.mjs check" }, cwd: dir },
      cursor: { hook_event_name: "beforeShellExecution", command: "node companion/dist/companion.mjs check", cwd: dir },
      codex: { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "node companion/dist/companion.mjs check" }, cwd: dir },
    }),
  },
  {
    name: "approval prompt",
    build: (dir) => ({
      verdict: { allow: true },
      claude: { hook_event_name: "UserPromptSubmit", prompt: "批准 CC-1234ABCD", cwd: dir, session_id: "s", turn_id: "t" },
      cursor: { hook_event_name: "beforeSubmitPrompt", prompt: "批准 CC-1234ABCD", cwd: dir, session_id: "s", turn_id: "t" },
      codex: { hook_event_name: "UserPromptSubmit", prompt: "批准 CC-1234ABCD", cwd: dir, session_id: "s", turn_id: "t" },
    }),
  },
  {
    name: "stop with a broken graph",
    build: (dir) => ({
      setup: () => { writeFileSync(graphPath(dir), YAML.replace("needs: [I-001]", "needs: [I-999]")); },
      verdict: { allow: false, reason: /I-999/ },
      claude: { hook_event_name: "Stop", stop_hook_active: false, cwd: dir },
      // Cursor 的 stop 没有 stop_hook_active，用 loop_count 表示「已经续过一轮」。
      cursor: { hook_event_name: "stop", status: "completed", loop_count: 0, cwd: dir },
      codex: { hook_event_name: "Stop", stop_hook_active: false, cwd: dir },
    }),
  },
  {
    name: "stop with a clean graph",
    build: (dir) => ({
      verdict: { allow: true },
      claude: { hook_event_name: "Stop", stop_hook_active: false, cwd: dir },
      cursor: { hook_event_name: "stop", status: "completed", loop_count: 0, cwd: dir },
      codex: { hook_event_name: "Stop", stop_hook_active: false, cwd: dir },
    }),
  },
  {
    name: "post-write recording",
    build: (dir) => ({
      verdict: { allow: true },
      claude: { hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: "src/a.ts", old_string: "// not yet", new_string: "export const a = 1;" }, cwd: dir },
      // Cursor 的写后事件把路径放在顶层 file_path 上，且不带工具名。
      cursor: { hook_event_name: "afterFileEdit", file_path: "src/a.ts", cwd: dir },
      codex: { hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: "src/a.ts", old_string: "// not yet", new_string: "export const a = 1;" }, cwd: dir },
    }),
  },
  {
    name: "a read",
    build: (dir) => ({
      verdict: { allow: true },
      claude: { hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "src/a.ts" }, cwd: dir },
      // 归一化器认得 Cursor 的 beforeReadFile 和 Codex 的 read_file（见下面那条
      // 单独的用例），但装出去的接线里没人订阅：cursorHooks() 根本没有读文件的
      // 钩子，codexHooks() 的 PostToolUse matcher 是
      // ^(Bash|apply_patch|Edit|Write|mcp__.*)$，不含 Read。所以 R7 的扫描清单
      // 「只有真实的读才划得掉」这条机器保证，今天仍然只有 Claude 一家有（D12/D22）。
      cursor: na("cursorHooks() 没订阅任何读文件事件，Cursor 的读永远到不了守卫（D12/D22）"),
      codex: na("codexHooks() 的 PostToolUse matcher 不含 Read，Codex 的读永远到不了守卫（D12/D22）"),
    }),
  },
];

describe("companion three-host contract table (H6)", () => {
  let dir: string;
  const dirs: string[] = [];

  const fixture = () => {
    const d = mkdtempSync(join(tmpdir(), "contract-"));
    dirs.push(d);
    mkdirSync(join(d, "ideas"), { recursive: true });
    mkdirSync(join(d, "tests"), { recursive: true });
    mkdirSync(join(d, "src"), { recursive: true });
    writeFileSync(join(d, "ideas", "graph.yaml"), YAML);
    writeFileSync(join(d, "tests", "a.test.txt"), "assert the thing\n");
    writeFileSync(join(d, "src", "a.ts"), "// not yet\n");
    writeFileSync(join(d, "checker.cjs"), `process.exit(require("fs").existsSync("impl.flag") ? 0 : 1);\n`);
    return d;
  };

  const HOSTS = [
    ["claude", normalizeClaude, (b: Built) => b.claude],
    ["cursor", normalizeCursor, (b: Built) => b.cursor],
    ["codex", normalizeCodex, (b: Built) => b.codex],
  ] as const;

  beforeEach(() => { dir = fixture(); });
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  // ── 表：一行一个场景，三家必须落在同一个归一化事件和同一个判决上 ─────────

  for (const row of TABLE) {
    it(`${row.name}: all three hosts normalize alike and decide alike`, () => {
      const built = row.build(dir);
      built.setup?.();

      const live = HOSTS
        .map(([host, normalize, pick]) => ({ host, cell: pick(built), normalize }))
        .filter((h) => !isNA(h.cell));
      expect(live.length, `${row.name}：三家全标了 n/a，这一行等于没测`).toBeGreaterThan(0);

      const seen = live.map(({ host, cell, normalize }) => {
        const event = normalize(cell as Raw);
        return { host, event, verdict: decide(event, dir) };
      });

      // (1) 同一个归一化事件 —— 只有工具名和工作目录可以不同（D22）
      for (const other of seen.slice(1)) {
        expect(shape(other.event), `${row.name}: ${seen[0].host} vs ${other.host}`)
          .toEqual(shape(seen[0].event));
      }

      // (2) 同一个判决，理由一字不差
      for (const one of seen) {
        expect(one.verdict.allow, `${row.name} @ ${one.host}: ${one.verdict.reason ?? ""}`)
          .toBe(built.verdict.allow);
        expect(one.verdict.reason ?? "", `${row.name} @ ${one.host} 的理由和 ${seen[0].host} 不一样`)
          .toBe(seen[0].verdict.reason ?? "");
        if (built.verdict.reason) expect(one.verdict.reason ?? "").toMatch(built.verdict.reason);
      }
    });
  }

  // ── 缺口要写在明面上 ─────────────────────────────────────────────────────

  it("every not-applicable cell is named out loud, so no gap hides in a missing column", () => {
    const gaps: string[] = [];
    for (const row of TABLE) {
      const built = row.build(dir);
      for (const [host, , pick] of HOSTS) {
        const cell = pick(built);
        if (isNA(cell)) gaps.push(`${row.name} · ${host} — ${cell.na}`);
      }
    }
    expect(gaps).toEqual([
      "a read · cursor — cursorHooks() 没订阅任何读文件事件，Cursor 的读永远到不了守卫（D12/D22）",
      "a read · codex — codexHooks() 的 PostToolUse matcher 不含 Read，Codex 的读永远到不了守卫（D12/D22）",
    ]);
  });

  it("the read gap is the WIRING, not the normalizer — all three agree once the event arrives", () => {
    const seen = [
      normalizeClaude({ hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "src/a.ts" }, cwd: dir }),
      normalizeCursor({ hook_event_name: "beforeReadFile", file_path: "src/a.ts", cwd: dir }),
      normalizeCodex({ hook_event_name: "PostToolUse", tool_name: "read_file", tool_input: { path: "src/a.ts" }, cwd: dir }),
    ];
    for (const event of seen) {
      expect(event.event).toBe("read");
      expect(shape(event)).toEqual(shape(seen[0]));
      expect(decide(event, dir)).toEqual(decide(seen[0], dir));
    }
  });

  // ── 路径拼法归一化器各不相同，判决必须相同 ───────────────────────────────

  it("the same file spelled three different ways still gets one verdict word for word", () => {
    const seen = [
      // Claude 给的是绝对路径（Windows 上还带反斜杠）
      normalizeClaude({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: join(dir, "src", "x.ts"), content: "x" }, cwd: dir }),
      // Cursor 给的是项目相对路径，键名也换了一个
      normalizeCursor({ hook_event_name: "preToolUse", tool_name: "Write", tool_input: { filePath: "src/x.ts", content: "x" }, cwd: dir }),
      // Codex 把整份补丁塞在 tool_input.command 里
      normalizeCodex({
        hook_event_name: "PreToolUse", tool_name: "apply_patch",
        tool_input: { command: "*** Begin Patch\n*** Add File: src/x.ts\n+x\n*** End Patch" }, cwd: dir,
      }),
    ];
    const verdicts = seen.map((event) => decide(event, dir));
    for (const v of verdicts) {
      expect(v.allow).toBe(false);
      expect(v.reason).toBe(verdicts[0].reason);       // 同一个 rel 路径，同一句话
      expect(v.reason).toMatch(/src\/x\.ts/);
    }
  });

  // ── 写后记录：三家写下同一行、加同一笔计数 ───────────────────────────────

  it("post-write recording writes the same log line and bumps the same counter on all three", () => {
    const seen = HOSTS.map(([host, normalize, pick]) => {
      const d = fixture();
      const built = TABLE.find((r) => r.name === "post-write recording")!.build(d);
      const event = normalize(pick(built) as Raw);
      expect(record(event, d).allow, host).toBe(true);
      const line = readFileSync(paths(d).log, "utf8").trim();
      return {
        host,
        entry: line.split(/ {2}/).slice(1).join("  "),   // 掐掉时间戳，只留「工具 路径」
        seq: JSON.parse(readFileSync(join(paths(d).runtime, "I-001.json"), "utf8")).change_seq,
      };
    });
    for (const one of seen) {
      expect(one.entry, one.host).toBe(seen[0].entry);
      expect(one.entry, one.host).toBe("Edit src/a.ts");
      expect(one.seq, one.host).toBe(1);
    }
  });

  // ── 批准：三家转达的同一句人话，走的是同一条消费路径 ─────────────────────

  it("the same approval answer is consumed identically whichever host relayed it", () => {
    for (const [host, normalize] of HOSTS) {
      const d = fixture();
      const { challenge } = requestApproval(d, load(graphPath(d)).graph, "plan", ["I-001"]);
      const prompt = `批准 ${challenge}`;
      const raw: Raw = host === "cursor"
        ? { hook_event_name: "beforeSubmitPrompt", prompt, cwd: d, session_id: "s", turn_id: "t" }
        : { hook_event_name: "UserPromptSubmit", prompt, cwd: d, session_id: "s", turn_id: "t" };
      const outcome = handlePrompt(normalize(raw), d);
      expect(outcome, host).toEqual({ ok: true, decision: "approved", gate: "plan" });
      expect(existsSync(join(paths(d).runtime, "approvals", `${challenge}.json`)), host).toBe(true);
    }
  });
});
