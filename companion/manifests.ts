// I-097 — the three platform wirings, and NOTHING else: which event calls
// which command. All three call the same single-file artifact; every rule
// lives in the shared guard. This file is the natural home of platform
// difference (D14) — event names and reply protocols genuinely differ (D15),
// and pretending otherwise is how a deny silently fails.
//
// Claude: exec form (command + args) with ${CLAUDE_PROJECT_DIR} — the
//   documented way to make placeholder paths safe on Windows. The old wiring
//   hardcoded an absolute machine path; a clone on any other machine got four
//   dead hooks that failed silently OPEN.
// Cursor: native hooks.json with failClosed on every blocking event — a
//   crashed gate must deny, not shrug.
// Codex: Claude-shaped events; ONE stable command string everywhere, because
//   trust is bound to the hash of the hook definition and an artifact update
//   must not force a re-trust round.
//
// Every command anchors the engine on the PROJECT ROOT, each in the way its own
// host offers, because a hook that cannot find the engine is not a hook that
// merely misbehaves: node exits 1, and Codex counts a failed hook as
// NON-blocking, so every write proceeds unguarded (D15 — a gate that cannot
// answer must never read as "allow").

/**
 * Where the installer places the bundle, relative to the target repo root.
 * Host-neutral on purpose (D14/D34): a Cursor-only or Codex-only repository
 * must not grow a `.claude/` tree for a file that is nobody's Claude file, and
 * the path is spelled out HERE and nowhere else — the manifests below, the
 * installer, and the five skill bodies all read this one constant.
 */
export const ENGINE_RELATIVE = ".companion/companion.mjs";

/** The engine's own directory: FORMAT.md ships next to it ("读引擎旁边的 FORMAT.md"). */
export const ENGINE_DIR = ENGINE_RELATIVE.slice(0, ENGINE_RELATIVE.lastIndexOf("/"));

/** What marks a hook entry as OURS, across engine relocations. */
export const ENGINE_MARKER = "companion.mjs";

const guardArgs = (platform: string) => [
  `\${CLAUDE_PROJECT_DIR}/${ENGINE_RELATIVE}`, "guard", `--platform=${platform}`,
];

// ─── which tools each event has to subscribe (D15/D22) ──────────────────────
// A matcher that names fewer tools than the normalizer classifies is a guard
// that is never CALLED — and an uncalled hook is not a quiet no-op: Codex counts
// a hook that did not answer as failed but NON-blocking, so the write proceeds
// (D15 — a gate that cannot answer must never read as "allow"). That is how the
// guard could learn Codex's `shell` / `local_shell` runners while the wiring
// still only said `Bash`, with every unit test green.
// So the matchers below are BUILT from one table of tool names instead of being
// hand-listed per host, and test_base_manifests.test.ts re-derives the table by
// feeding names through the normalizers themselves — the same names, one place.
// (guard.ts owns the authoritative sets — SHELL_TOOLS, READ_TOOLS,
// CLAUDE_WRITE_TOOLS, CURSOR_WRITE_TOOLS — but exports none of them; when it
// does, import them here and delete the copies.)

/** Names the guard compares case-INSENSITIVELY (it lower-cases the tool name
 *  first; Cursor's table carries /i). Both spellings go in the matcher: to the
 *  guard `shell` and `Shell` are one tool, so the wiring may not know only one. */
const anyCase = (names: string[]) => [...new Set(names.flatMap((n) => [n, n.toLowerCase()]))];

/** guard.ts SHELL_TOOLS — Claude registers Bash/PowerShell, Codex spells its
 *  runner shell/local_shell. Cursor's shell has its own event and no tool name. */
const SHELL_TOOLS = anyCase(["Bash", "PowerShell", "pwsh", "shell", "local_shell"]);
/** guard.ts READ_TOOLS — only a real read strikes the scan worklist (R7/D12). */
const READ_TOOLS = anyCase(["Read", "read_file", "readfile"]);
/** guard.ts CLAUDE_WRITE_TOOLS / CURSOR_WRITE_TOOLS, and Codex's `^(Edit|Write)$`. */
const CLAUDE_WRITE_TOOLS = ["Edit", "Write", "NotebookEdit"];   // matched case-sensitively
const CURSOR_WRITE_TOOLS = anyCase(["Write", "StrReplace", "Delete", "EditNotebook", "ApplyPatch", "search_replace"]);
const CODEX_WRITE_TOOLS = ["Edit", "Write"];
/** Codex's patch tool: one call, many files, its own parser in the guard (D23). */
const PATCH_TOOLS = ["apply_patch"];
/** MCP is a name PREFIX rather than a name; Cursor also spells it `MCP:`. */
const MCP_TOOLS = ["mcp__.*"];
const CURSOR_MCP_TOOLS = ["mcp__.*", "MCP:.*"];
/** The host's own page-fetching tool (I-106). R8 judges a fetch by its TARGET
 *  (a loopback address is refused, the open web passes), but that rule only
 *  ever fires if the event reaches the guard — and this tool wears neither the
 *  write nor the `mcp__` shape. Cursor and Codex expose no such named tool. */
const CLAUDE_FETCH_TOOLS = ["WebFetch"];

const matcher = (...groups: string[][]) => [...new Set(groups.flat())].join("|");
/** Codex anchors its matchers; the prefix patterns keep their own `.*` inside. */
const anchored = (...groups: string[][]) => `^(${matcher(...groups)})$`;

/** The `hooks` fragment merged into <target>/.claude/settings.json. */
export function claudeHooks(): Record<string, unknown[]> {
  const guard = (timeout?: number) => [{
    type: "command", command: "node", args: guardArgs("claude"),
    ...(timeout ? { timeout } : {}),
  }];
  return {
    PreToolUse: [
      { matcher: matcher(CLAUDE_WRITE_TOOLS, SHELL_TOOLS, CLAUDE_FETCH_TOOLS), hooks: guard() },
      { matcher: matcher(MCP_TOOLS), hooks: guard() },
    ],
    // Reads strike the scan worklist (R7); the MCP group is here too because an
    // MCP write is a write and R1 records every one of them — it was the one
    // shape that finished unlogged on this host.
    PostToolUse: [
      { matcher: matcher(CLAUDE_WRITE_TOOLS, READ_TOOLS), hooks: guard() },
      { matcher: matcher(MCP_TOOLS), hooks: guard() },
    ],
    // The platform default here is 30s and a timed-out hook's output is
    // silently discarded — with a slow start that is a LOST APPROVAL. The
    // bundle starts fast, and the explicit timeout buys headroom anyway.
    UserPromptSubmit: [{ hooks: guard(120) }],
    Stop: [{ hooks: guard() }],
    // Session briefing (absorbed from Cursor): the engine's status table goes
    // into context at session start, so every session opens knowing the graph.
    // Through the GUARD, like the other two hosts — calling the engine's `status`
    // subcommand straight from the wiring is a second way into the same briefing,
    // and a second way is a second thing to keep in step (D22 — one event, one
    // rule table). It is also the only path that never sees D9: the guard catches
    // a graph it cannot read and opens the session silently, while the bare
    // subcommand prints a stack trace at the human.
    SessionStart: [{ hooks: guard() }],
  };
}

/** The whole <target>/.cursor/hooks.json (merged, never clobbered). */
export function cursorHooks(): { version: number; hooks: Record<string, unknown[]> } {
  // Cursor's anchor is its own documented working directory: project hooks
  // "run from the project root", and the docs spell paths root-relative
  // (`.cursor/hooks/format.sh`, never `./hooks/format.sh`). So the root-relative
  // path IS the anchor here. Nothing is documented about whether the command
  // string reaches a shell, and a `$VAR` that never expands would land on
  // failClosed and deny the whole repository — a placeholder is the riskier
  // choice on this host, not the safer one.
  const command = `node ${ENGINE_RELATIVE} guard --platform=cursor`;
  const blocking = { command, failClosed: true };
  return {
    version: 1,
    hooks: {
      // Cursor's shell and its reads arrive on their own events below, carrying
      // no tool name at all — so this matcher is the write tools plus MCP, the
      // only two shapes normalizeCursor reads a tool NAME for (D15/D22).
      preToolUse: [{ ...blocking, matcher: matcher(CURSOR_WRITE_TOOLS, CURSOR_MCP_TOOLS) }],
      beforeShellExecution: [{ ...blocking }],
      beforeMCPExecution: [{ ...blocking }],
      afterFileEdit: [{ command }],
      beforeSubmitPrompt: [{ command }],
      stop: [{ command }],
      sessionStart: [{ command }],
    },
  };
}

/** The whole <target>/.codex/hooks.json (Claude-shaped, per official docs). */
export function codexHooks(): { hooks: Record<string, unknown[]> } {
  // Codex runs hook commands with the SESSION working directory and its docs
  // warn a session may start in a subdirectory — a relative engine path there
  // is MODULE_NOT_FOUND, exit 1, which Codex treats as a failed but NON-blocking
  // hook: the write goes through unguarded (D15). The remedy is the one the
  // docs themselves prescribe, resolving from the git root; `|| pwd` keeps a
  // checkout that is not a git repository at the old behaviour instead of
  // pointing at the filesystem root. cmd.exe has no `$(…)` and would take it
  // literally, so Windows gets Codex's own `commandWindows` override, anchored
  // the same way (`|| cd` prints the current directory when git has no answer).
  // One string per platform, everywhere: Codex trusts the HASH of the hook
  // definition, and an artifact update must not force a re-trust round.
  const command = `node "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/${ENGINE_RELATIVE}" guard --platform=codex`;
  const commandWindows = `for /f "delims=" %g in ('git rev-parse --show-toplevel 2^>nul ^|^| cd') do @node "%g/${ENGINE_RELATIVE}" guard --platform=codex`;
  const guard = (matcher?: string) => [{
    ...(matcher ? { matcher } : {}),
    hooks: [{ type: "command", command, commandWindows, timeout: 30 }],
  }];
  return {
    hooks: {
      // Pre gets the shell runners (Codex calls them shell / local_shell), Post
      // gets the read tools instead — after the fact a shell is nothing the
      // guard can act on, while a finished read is what strikes the worklist
      // (R7/D12). Both keep the writes, the patch tool and MCP.
      PreToolUse: guard(anchored(CODEX_WRITE_TOOLS, PATCH_TOOLS, SHELL_TOOLS, MCP_TOOLS)),
      PostToolUse: guard(anchored(CODEX_WRITE_TOOLS, PATCH_TOOLS, READ_TOOLS, MCP_TOOLS)),
      UserPromptSubmit: guard(),
      Stop: guard(),
      SessionStart: guard(),
    },
  };
}
