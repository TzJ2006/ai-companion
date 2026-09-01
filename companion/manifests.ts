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

/** Where the installer places the bundle, relative to the target repo root. */
export const ENGINE_RELATIVE = ".claude/companion/companion.mjs";

const guardArgs = (platform: string) => [
  `\${CLAUDE_PROJECT_DIR}/${ENGINE_RELATIVE}`, "guard", `--platform=${platform}`,
];

/** The `hooks` fragment merged into <target>/.claude/settings.json. */
export function claudeHooks(): Record<string, unknown[]> {
  const guard = (timeout?: number) => [{
    type: "command", command: "node", args: guardArgs("claude"),
    ...(timeout ? { timeout } : {}),
  }];
  return {
    PreToolUse: [
      { matcher: "Edit|Write|NotebookEdit|Bash|PowerShell", hooks: guard() },
      { matcher: "mcp__.*", hooks: guard() },
    ],
    PostToolUse: [
      { matcher: "Edit|Write|NotebookEdit|Read", hooks: guard() },
    ],
    // The platform default here is 30s and a timed-out hook's output is
    // silently discarded — with a slow start that is a LOST APPROVAL. The
    // bundle starts fast, and the explicit timeout buys headroom anyway.
    UserPromptSubmit: [{ hooks: guard(120) }],
    Stop: [{ hooks: guard() }],
    // Session briefing (absorbed from Cursor): the engine's status table goes
    // into context at session start, so every session opens knowing the graph.
    SessionStart: [{
      hooks: [{ type: "command", command: "node",
        args: [`\${CLAUDE_PROJECT_DIR}/${ENGINE_RELATIVE}`, "status"] }],
    }],
  };
}

/** The whole <target>/.cursor/hooks.json (merged, never clobbered). */
export function cursorHooks(): { version: number; hooks: Record<string, unknown[]> } {
  const command = `node ${ENGINE_RELATIVE} guard --platform=cursor`;
  const blocking = { command, failClosed: true };
  return {
    version: 1,
    hooks: {
      preToolUse: [{ ...blocking, matcher: "Write|StrReplace|Delete|EditNotebook|ApplyPatch|search_replace" }],
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
  // One string, everywhere: Codex trusts the HASH of the hook definition.
  const command = `node ${ENGINE_RELATIVE} guard --platform=codex`;
  const guard = (matcher?: string) => [{
    ...(matcher ? { matcher } : {}),
    hooks: [{ type: "command", command, timeout: 30 }],
  }];
  return {
    hooks: {
      PreToolUse: guard("^(Bash|apply_patch|Edit|Write|mcp__.*)$"),
      PostToolUse: guard("^(Bash|apply_patch|Edit|Write|mcp__.*)$"),
      UserPromptSubmit: guard(),
      Stop: guard(),
      SessionStart: guard(),
    },
  };
}
