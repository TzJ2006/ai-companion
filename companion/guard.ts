#!/usr/bin/env tsx
// The shared policy core (I-093). ONE rule table for Claude, Cursor and Codex:
// a normalized event comes in, an allow/deny with a human-readable reason goes
// out. The per-platform translation (event names in, reply JSON out) is the
// thin layer in this same file's adapters (I-094); nothing platform-shaped is
// allowed in here.
//
// The rules, each adjudicated in companion/FORMAT.md:
//   D16  a product file no ready `doing` idea claims is denied by default
//   —    the doing idea's own test files are writable from the start:
//        writing the failing test IS the only legal first move (D8)
//   D7   implementation needs a current, content-bound plan approval
//   D8   implementation needs a fresh RED — run-check recorded a real failure
//   D24  runtime evidence, receipts, scan lists, generated html: CLI-only
//   R2   the graph stays editable prose, but status/signed_off flips must go
//        through `set` / a manual-check challenge (D27)
//   D21  shell writes (redirects, sed -i, one-liner interpreters, git
//        rewrites, package installs) hit the same wall
//   D23  a write whose target cannot be determined is denied, not excused
//   R5   the session may not stop while `check` reports errors
//   D9   crash direction: pre-write/approval/stop fail CLOSED, post-write
//        recording fails OPEN — a recorder bug must not stop the work, a
//        policy bug must not wave irreversible writes through
//   D25  AIDEV_GUARD=off is the one escape hatch, and it is loud

import { readFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { platform } from "node:process";
import { parseDocument } from "yaml";
import {
  load, graphPath, paths, check, recordChange, decideProductWrite,
  type Graph, type Status,
} from "./ideas.js";

// ─── the normalized event — the only shape the rules ever see (D22) ─────────

export interface NormalizedEvent {
  event: "pre-write" | "post-write" | "shell" | "prompt" | "stop" | "other";
  tool?: string;
  /** Files the action would touch; absolute or project-relative. */
  paths?: string[];
  /** For apply_patch-style tools: one entry per file operation. */
  operations?: { kind: "add" | "update" | "delete"; path: string }[];
  /** For shell events: the raw command string. */
  command?: string;
  /** For prompt events: the human's literal message. */
  prompt?: string;
  cwd?: string;
  /** The pending edit, when the platform supplies it (graph-edit diffing). */
  edit?: { old_string?: string; new_string?: string; content?: string; replace_all?: boolean };
  /** Write-capable call whose target could not be parsed (D23). */
  unknownTarget?: boolean;
  stop_hook_active?: boolean;
  /** Provenance for approval receipts, when the platform provides it. */
  session_id?: string;
  turn_id?: string;
}

export interface Verdict { allow: boolean; reason?: string; warn?: string }

const OK: Verdict = { allow: true };

// ─── path plumbing ──────────────────────────────────────────────────────────

const norm = (p: string) => p.replaceAll("\\", "/").replace(/\/+$/, "");

const sameFile = (a: string, b: string) =>
  platform === "win32" ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);

/** Project-relative forward-slash path, whatever the platform handed us. */
function relTo(projectDir: string, filePath: string): string {
  const root = norm(resolve(projectDir));
  const full = norm(resolve(projectDir, filePath));
  const hit = platform === "win32"
    ? full.toLowerCase().startsWith(root.toLowerCase() + "/")
    : full.startsWith(root + "/");
  return hit ? full.slice(root.length + 1) : full;
}

const startsWithSeg = (rel: string, prefix: string) =>
  platform === "win32"
    ? rel.toLowerCase() === prefix.toLowerCase() || rel.toLowerCase().startsWith(prefix.toLowerCase() + "/")
    : rel === prefix || rel.startsWith(prefix + "/");

// ─── the entry: crash direction is decided HERE (D9, D25) ───────────────────

export function decide(event: NormalizedEvent, projectDir: string, opts: { guardOff?: boolean } = {}): Verdict {
  if (opts.guardOff) {
    return { allow: true, warn: "AIDEV_GUARD=off — 七条规则全部停用。这是逃生口，不是常态；记录里会写明强制当时是关着的。" };
  }
  try {
    return decideInner(event, projectDir);
  } catch (error) {
    const what = error instanceof Error ? error.message : String(error);
    if (event.event === "post-write") {
      return { allow: true, warn: `写后记录失败（${what}）—— 已完成的写不被追拦（D9），但这笔没记上。` };
    }
    // Pre-write, approval and stop: a guard that crashed proved nothing, and an
    // irreversible write it failed to inspect cannot be un-written (D9).
    return { allow: false, reason: `守卫自身出错（${what}）—— 写前环节按 D9 拦下。真被卡死时的逃生口：AIDEV_GUARD=off（会被醒目记录）。` };
  }
}

function decideInner(event: NormalizedEvent, projectDir: string): Verdict {
  switch (event.event) {
    case "post-write": return OK;                       // recording lives in record()
    case "prompt": return OK;                           // approval consumption lives in the adapter (I-094)
    case "stop": return ruleStop(event, projectDir);
    case "shell": return ruleShell(event, projectDir);
    case "pre-write": return rulePreWrite(event, projectDir);
    default: return OK;
  }
}

// ─── pre-write ──────────────────────────────────────────────────────────────

function loadGraphStrict(projectDir: string): Graph {
  if (!existsSync(graphPath(projectDir))) {
    throw new Error("还没有想法图（ideas/graph.yaml）—— 先 init 或 migrate。没图就没有授权，默认拒绝（D16）");
  }
  return load(graphPath(projectDir)).graph;             // throws on broken YAML → fail closed
}

function rulePreWrite(event: NormalizedEvent, projectDir: string): Verdict {
  const targets = [
    ...(event.paths ?? []),
    ...(event.operations ?? []).map((op) => op.path),
  ];
  if (event.unknownTarget || targets.length === 0) {
    return { allow: false, reason: "这个调用可能写文件，但看不出写到哪 —— 严格模式下 unknown 不等于 allowed（D23）。用能带出文件路径的工具，或走 companion CLI。" };
  }
  const graph = loadGraphStrict(projectDir);
  for (const target of targets) {
    const verdict = decideOnePath(event, graph, projectDir, target);
    if (!verdict.allow) return verdict;                 // one bad file refuses the whole batch
  }
  return OK;
}

function decideOnePath(event: NormalizedEvent, graph: Graph, projectDir: string, target: string): Verdict {
  // The graph gets its own diff-aware rule (status/signed_off need the edit).
  if (sameFile(resolve(projectDir, target).replaceAll("\\", "/"), paths(projectDir).graph.replaceAll("\\", "/"))) {
    return ruleGraphEdit(event, projectDir);
  }
  // Everything else — protected evidence, read-only legacy graphs, the prose
  // ledger, and the product-file triple gate — is the engine's verdict,
  // verbatim: the `allow` command runs the SAME function (I-099).
  const verdict = decideProductWrite(projectDir, graph, target);
  return verdict.allow ? OK : { allow: false, reason: verdict.reason };
}

// R2 + D27: the graph is editable prose, but two things only move via the CLI.
function ruleGraphEdit(event: NormalizedEvent, projectDir: string): Verdict {
  const file = graphPath(projectDir);
  if (!existsSync(file) || !event.edit) return OK;
  const current = readFileSync(file, "utf8");
  const next = afterEdit(current, event.edit);
  if (next === null) return OK;

  const before = fieldMaps(current);
  const after = fieldMaps(next);
  const flipped = [...before.status].filter(([id, s]) => after.status.has(id) && after.status.get(id) !== s);
  if (flipped.length > 0) {
    return {
      allow: false,
      reason: `不能手改已有想法的 status（${flipped.map(([id, s]) => `${id}: ${s} → ${after.status.get(id)}`).join("; ")}）—— 用 set，它会校验转移表、就绪条件和证据（R2/D19）。`,
    };
  }
  const signed = [...before.signed.keys()].filter((id) => before.signed.get(id) !== after.signed.get(id));
  if (signed.length > 0) {
    return {
      allow: false,
      reason: `人工验收的签字（${signed.join(", ")} 的 verify.signed_off）只能经 manual-check 口令产生，agent 不能代签（D27）—— request-approval --gate manual-check --node ${signed[0]}。`,
    };
  }
  return OK;
}

function afterEdit(current: string, edit: NonNullable<NormalizedEvent["edit"]>): string | null {
  if (edit.content !== undefined) return edit.content;
  if (edit.old_string === undefined || edit.new_string === undefined) return null;
  return edit.replace_all
    ? current.split(edit.old_string).join(edit.new_string)
    : current.replace(edit.old_string, edit.new_string);
}

function fieldMaps(text: string): { status: Map<string, string>; signed: Map<string, string> } {
  const status = new Map<string, string>();
  const signed = new Map<string, string>();
  try {
    const graph = parseDocument(text).toJSON() as Graph;
    for (const idea of graph?.ideas ?? []) {
      if (!idea?.id) continue;
      status.set(idea.id, (idea.status ?? "todo") as Status);
      signed.set(idea.id, JSON.stringify(idea.verify?.signed_off ?? null));
    }
  } catch { /* unparseable: nothing to compare — the write itself may still be a fix */ }
  return { status, signed };
}

// ─── shell (D21) ────────────────────────────────────────────────────────────
// Ported from the Codex implementation's three-layer screen. This is a
// guardrail, not a sandbox — the visible bypasses are closed, and the honest
// boundary is written down in FORMAT.md.

const MUTATING_SHELL = new RegExp([
  String.raw`(^|[\s;&|])(rm|del|rmdir|mv|cp|tee|touch)\b`,
  String.raw`\bsed\b[^\n]*\s-i\b`,
  String.raw`\bperl\b[^\n]*\s-i\b`,
  String.raw`\bgit\s+(apply|checkout|clean|commit|merge|mv|reset|restore|revert)\b`,
  String.raw`\b(npm|pnpm|yarn|pip|pip3|poetry)\s+(add|install|remove|uninstall|update)\b`,
  String.raw`\b(Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Move-Item|Copy-Item|Rename-Item)\b`,
  String.raw`[^<]>{1,2}`,                                // > and >> redirects (not <)
].join("|"), "i");

const ONE_LINER_INTERPRETER = /\b(python[0-9.]*|node|ruby|perl)\s+(-\S*\s+)*-[ce]\b/i;

/** The companion CLI itself, with no shell metacharacters smuggled alongside. */
const COMPANION_CLI = /^(npx\s+tsx|node)\s+\S*(companion\.mjs|ideas\.ts|guard\.ts)\s[^;&|<>]*$/i;

function ruleShell(event: NormalizedEvent, projectDir: string): Verdict {
  const command = (event.command ?? "").trim();
  if (!command) return OK;

  // A doing idea's declared verify command is the sanctioned way to run tests.
  try {
    const graph = loadGraphStrict(projectDir);
    const declared = graph.ideas.some((i) => i.status === "doing" && i.verify?.command?.trim() === command);
    if (declared) return OK;
  } catch { /* no graph — fall through to the pattern screen */ }

  if (COMPANION_CLI.test(command)) return OK;
  if (MUTATING_SHELL.test(command)) {
    return { allow: false, reason: `shell 里的写文件招数和文件工具走同一道闸（D21）：「${command.slice(0, 80)}」被拦。改产品文件用编辑工具（会经守卫检查）；跑测试用 run-check。` };
  }
  if (ONE_LINER_INTERPRETER.test(command)) {
    return { allow: false, reason: `解释器一行流（python -c / node -e …）绕得过路径检查，统一走 run-check（D21）。` };
  }
  return OK;
}

// ─── stop (R5) ──────────────────────────────────────────────────────────────

function ruleStop(event: NormalizedEvent, projectDir: string): Verdict {
  if (event.stop_hook_active) return OK;                // never loop a stop hook
  if (!existsSync(graphPath(projectDir))) return OK;
  const graph = load(graphPath(projectDir)).graph;
  const { errors } = check(graph, projectDir);
  if (errors.length === 0) return OK;
  return {
    allow: false,
    reason: `想法图有 ${errors.length} 个错误，修完再结束（R5）：\n${errors.map((e) => `  - ${e}`).join("\n")}`,
  };
}

// ─── post-write recording (R1 + I-091's change counter) ─────────────────────
// Never throws outward: a recorder bug must not block finished work (D9).

export function record(event: NormalizedEvent, projectDir: string): Verdict {
  try {
    const targets = [...(event.paths ?? []), ...(event.operations ?? []).map((op) => op.path)];
    if (targets.length === 0) return OK;
    let graph: Graph | null = null;
    try { graph = load(graphPath(projectDir)).graph; } catch { graph = null; }
    for (const target of targets) {
      const rel = relTo(projectDir, target);
      if (graph) {
        try { recordChange(projectDir, graph, rel); } catch { /* counter miss ≠ blocked write */ }
      }
      try {
        const file = paths(projectDir).log;
        mkdirSync(dirname(file), { recursive: true });
        const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
        appendFileSync(file, `- ${stamp}  ${event.tool ?? "write"} ${rel}\n`);
      } catch { /* logging must never block */ }
    }
    return OK;
  } catch (error) {
    return { allow: true, warn: `写后记录失败（${error instanceof Error ? error.message : error}）—— 放行但没记上（D9）。` };
  }
}

// ─── the thin platform layer (I-094, D15/D22) ───────────────────────────────
// Three normalize functions in, three encoders out. Official compatibility only
// guarantees the events FIRE — not that the JSON looks the same: Claude hands
// file_path with backslashes, Cursor spells paths five ways and answers in a
// flat permission object, Codex ships whole multi-file patches inside
// tool_input.command and does not support "ask" on PreToolUse (a hook that
// says ask is marked failed and the tool RUNS). Everything platform-shaped
// lives below this line and nowhere else.

export interface WireReply { exitCode: number; stdout?: string; stderr?: string }

interface RawHook {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: unknown;
  command?: string;
  prompt?: string;
  cwd?: string;
  stop_hook_active?: boolean;
  loop_count?: number;
  status?: string;
  session_id?: string;
  turn_id?: string;
  file_path?: string;
  mcp_server_name?: string;
}

const CLAUDE_WRITE_TOOLS = /^(Edit|Write|NotebookEdit)$/;
const CURSOR_WRITE_TOOLS = /^(Write|StrReplace|Delete|EditNotebook|ApplyPatch|search_replace)$/i;
/** An MCP tool whose NAME admits it writes. A nameless path still counts. */
const MCP_WRITEISH = /write|edit|create|delete|update|move|save|patch|append|remove|rename/i;

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
  }
  return (value && typeof value === "object") ? value as Record<string, unknown> : {};
}

/** The five spellings of "which file" seen across the three platforms. */
function extractPath(input: Record<string, unknown>): string | undefined {
  for (const key of ["file_path", "path", "filePath", "uri", "target_notebook", "notebook_path"]) {
    const value = input[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

function editOf(input: Record<string, unknown>): NormalizedEvent["edit"] {
  return {
    old_string: input["old_string"] as string | undefined,
    new_string: input["new_string"] as string | undefined,
    content: input["content"] as string | undefined,
    replace_all: input["replace_all"] as boolean | undefined,
  };
}

/** One event for any MCP tool call, on any platform. */
function mcpEvent(kind: "pre-write" | "post-write", tool: string, input: Record<string, unknown>, raw: RawHook): NormalizedEvent {
  const path = extractPath(input);
  if (path) return { event: kind, tool, paths: [path], cwd: raw.cwd };
  if (MCP_WRITEISH.test(tool)) {
    return { event: kind, tool, paths: [], unknownTarget: kind === "pre-write", cwd: raw.cwd };
  }
  return { event: "other", tool, cwd: raw.cwd };        // a read-shaped MCP call is not ours to block
}

/** apply_patch: every `*** Add|Update|Delete File:` line is one operation. */
const PATCH_OP = /^\*{3} (Add|Update|Delete) File: (.+?)\s*$/gm;

function patchOperations(text: string): { kind: "add" | "update" | "delete"; path: string }[] {
  const out: { kind: "add" | "update" | "delete"; path: string }[] = [];
  for (const m of text.matchAll(PATCH_OP)) {
    out.push({ kind: m[1].toLowerCase() as "add" | "update" | "delete", path: m[2] });
  }
  return out;
}

// ── Claude Code ─────────────────────────────────────────────────────────────

export function normalizeClaude(raw: RawHook): NormalizedEvent {
  const input = asRecord(raw.tool_input);
  const tool = raw.tool_name ?? "";
  switch (raw.hook_event_name) {
    case "PreToolUse":
      if (tool === "Bash") return { event: "shell", tool, command: input["command"] as string, cwd: raw.cwd };
      if (CLAUDE_WRITE_TOOLS.test(tool)) {
        const path = extractPath(input);
        return { event: "pre-write", tool, paths: path ? [path] : [], unknownTarget: !path, edit: editOf(input), cwd: raw.cwd };
      }
      if (tool.startsWith("mcp__")) return mcpEvent("pre-write", tool, input, raw);
      return { event: "other", tool, cwd: raw.cwd };
    case "PostToolUse": {
      const path = extractPath(input);
      if (tool === "Read" || !path) return { event: "other", tool, paths: path ? [path] : [], cwd: raw.cwd };
      return { event: "post-write", tool, paths: [path], cwd: raw.cwd };
    }
    case "UserPromptSubmit":
      return { event: "prompt", prompt: raw.prompt, cwd: raw.cwd, session_id: raw.session_id, turn_id: raw.turn_id };
    case "Stop":
      return { event: "stop", stop_hook_active: raw.stop_hook_active === true, cwd: raw.cwd };
    default:
      return { event: "other", cwd: raw.cwd };
  }
}

export function encodeClaude(event: NormalizedEvent, verdict: Verdict): WireReply {
  if (verdict.allow) return { exitCode: 0, stderr: verdict.warn };
  if (event.event === "pre-write" || event.event === "shell") {
    return {
      exitCode: 2,
      stdout: JSON.stringify({ hookSpecificOutput: {
        hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: verdict.reason ?? "blocked",
      } }),
      stderr: verdict.reason,
    };
  }
  return { exitCode: 2, stderr: verdict.reason };       // stop / prompt: exit 2 + stderr is the block
}

// ── Cursor (native hooks.json events, flat permission replies) ──────────────

export function normalizeCursor(raw: RawHook): NormalizedEvent {
  const input = asRecord(raw.tool_input);
  const tool = raw.tool_name ?? "";
  switch (raw.hook_event_name) {
    case "preToolUse":
      if (CURSOR_WRITE_TOOLS.test(tool)) {
        const path = extractPath(input);
        return { event: "pre-write", tool, paths: path ? [path] : [], unknownTarget: !path, edit: editOf(input), cwd: raw.cwd };
      }
      if (tool.startsWith("mcp__") || tool.startsWith("MCP:")) return mcpEvent("pre-write", tool, input, raw);
      return { event: "other", tool, cwd: raw.cwd };
    case "beforeShellExecution":
      return { event: "shell", command: raw.command, cwd: raw.cwd };
    case "beforeMCPExecution":
      return mcpEvent("pre-write", tool, input, raw);
    case "afterFileEdit": {
      const path = raw.file_path ?? extractPath(input);
      return { event: "post-write", tool: "Edit", paths: path ? [path] : [], cwd: raw.cwd };
    }
    case "beforeSubmitPrompt":
      return { event: "prompt", prompt: raw.prompt, cwd: raw.cwd, session_id: raw.session_id, turn_id: raw.turn_id };
    case "stop":
      // Cursor caps followups with loop_limit; after the first re-prompt we
      // treat it like Claude's stop_hook_active and let go.
      return { event: "stop", stop_hook_active: (raw.loop_count ?? 0) > 0, cwd: raw.cwd };
    default:
      return { event: "other", cwd: raw.cwd };
  }
}

export function encodeCursor(event: NormalizedEvent, verdict: Verdict): WireReply {
  if (event.event === "stop") {
    return { exitCode: 0, stdout: JSON.stringify(verdict.allow ? {} : { followup_message: verdict.reason }) };
  }
  if (event.event === "prompt") {
    return { exitCode: 0, stdout: JSON.stringify({ continue: true }) };
  }
  if (event.event === "post-write" || event.event === "other") {
    return { exitCode: 0, stdout: "{}" };
  }
  return {
    exitCode: 0,                                        // Cursor reads the JSON, not the exit code
    stdout: JSON.stringify(verdict.allow
      ? { permission: "allow" }
      : { permission: "deny", user_message: verdict.reason, agent_message: `Companion 拦下了这次操作。${verdict.reason ?? ""}` }),
  };
}

// ── Codex (Claude-shaped events; apply_patch carries whole patches) ─────────

export function normalizeCodex(raw: RawHook): NormalizedEvent {
  const input = asRecord(raw.tool_input);
  const tool = raw.tool_name ?? "";
  if (raw.hook_event_name === "PreToolUse" || raw.hook_event_name === "PostToolUse") {
    const kind = raw.hook_event_name === "PreToolUse" ? "pre-write" as const : "post-write" as const;
    if (tool === "apply_patch") {
      const text = String(input["command"] ?? input["patch"] ?? "");
      const operations = patchOperations(text);
      if (operations.length === 0) {
        // Strict mode could not parse a single operation out of the patch:
        // deny the lot rather than guessing (D23).
        return { event: kind, tool, paths: [], unknownTarget: kind === "pre-write", cwd: raw.cwd };
      }
      return { event: kind, tool, operations, paths: [], cwd: raw.cwd };
    }
    if (tool === "Bash") {
      return kind === "pre-write"
        ? { event: "shell", tool, command: input["command"] as string, cwd: raw.cwd }
        : { event: "other", tool, cwd: raw.cwd };
    }
    if (/^(Edit|Write)$/.test(tool)) {
      const path = extractPath(input);
      return { event: kind, tool, paths: path ? [path] : [], unknownTarget: kind === "pre-write" && !path, edit: editOf(input), cwd: raw.cwd };
    }
    if (tool.startsWith("mcp__")) return mcpEvent(kind, tool, input, raw);
    return { event: "other", tool, cwd: raw.cwd };
  }
  if (raw.hook_event_name === "UserPromptSubmit") {
    return { event: "prompt", prompt: raw.prompt, cwd: raw.cwd, session_id: raw.session_id, turn_id: raw.turn_id };
  }
  if (raw.hook_event_name === "Stop") {
    return { event: "stop", stop_hook_active: raw.stop_hook_active === true, cwd: raw.cwd };
  }
  return { event: "other", cwd: raw.cwd };
}

export function encodeCodex(event: NormalizedEvent, verdict: Verdict): WireReply {
  if (verdict.allow) return { exitCode: 0, stderr: verdict.warn };
  if (event.event === "stop") {
    return { exitCode: 0, stdout: JSON.stringify({ decision: "block", reason: verdict.reason ?? "blocked" }) };
  }
  // PreToolUse: allow/deny ONLY — Codex treats "ask" as a failed hook and runs
  // the tool anyway, so emitting it would be a silent allow.
  return {
    exitCode: 2,
    stdout: JSON.stringify({ hookSpecificOutput: {
      hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: verdict.reason ?? "blocked",
    } }),
    stderr: verdict.reason,
  };
}

// ─── shared prompt handling and the process entry ───────────────────────────

import { applyApproval, strike } from "./ideas.js";

/** Approval challenges are consumed identically whichever agent relayed them. */
export function handlePrompt(event: NormalizedEvent, projectDir: string): ReturnType<typeof applyApproval> {
  if (event.event !== "prompt" || !event.prompt) return null;
  return applyApproval(projectDir, event.prompt, {
    date: new Date().toISOString().slice(0, 10),
    session_id: event.session_id,
    turn_id: event.turn_id,
  });
}

const ENCODERS = { claude: encodeClaude, cursor: encodeCursor, codex: encodeCodex } as const;
const NORMALIZERS = { claude: normalizeClaude, cursor: normalizeCursor, codex: normalizeCodex } as const;
export type Platform = keyof typeof ENCODERS;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** The hook entry, callable from the bundle's cli (I-096) or directly. */
export function runGuard(args: string[]): void {
  const platformArg = (args.find((a) => a.startsWith("--platform="))?.slice(11) ?? "claude") as Platform;
  readStdin().then((rawText) => {
    let raw: RawHook;
    try { raw = JSON.parse(rawText || "{}") as RawHook; } catch { process.exit(0); return; }
    const projectDir = resolve(raw.cwd ?? process.cwd());
    const guardOff = process.env.AIDEV_GUARD === "off";
    const normalize = NORMALIZERS[platformArg] ?? normalizeClaude;
    const encode = ENCODERS[platformArg] ?? encodeClaude;
    const event = normalize(raw);

    if (guardOff) {
      // D25: the escape hatch works, and it leaves a mark.
      try {
        mkdirSync(dirname(paths(projectDir).log), { recursive: true });
        appendFileSync(paths(projectDir).log,
          `- ${new Date().toISOString().replace("T", " ").slice(0, 16)}  guard.disabled  AIDEV_GUARD=off 期间发生 ${event.event}\n`);
      } catch { /* best effort */ }
    }
    if (event.event === "prompt" && !guardOff) {
      const outcome = handlePrompt(event, projectDir);
      if (outcome) {
        process.stdout.write(outcome.ok
          ? `Companion：${outcome.decision === "approved" ? "批准" : "拒绝"}已记录（${outcome.gate}）。\n`
          : `Companion：${outcome.reason}\n`);
      }
    }
    if (event.event === "other" && raw.hook_event_name === "PostToolUse" && raw.tool_name === "Read") {
      // R7: only a real Read strikes the scan worklist.
      try {
        const path = extractPath(asRecord(raw.tool_input));
        if (path) strike(projectDir, path);
      } catch { /* never block a read */ }
    }
    if (event.event === "post-write" && !guardOff) {
      const recorded = record(event, projectDir);
      if (recorded.warn) process.stderr.write(recorded.warn + "\n");
      process.exit(0);
      return;
    }
    const verdict = decide(event, projectDir, { guardOff });
    const reply = encode(event, verdict);
    if (verdict.warn) process.stderr.write(verdict.warn + "\n");
    if (reply.stdout) process.stdout.write(reply.stdout);
    if (reply.stderr && !verdict.warn) process.stderr.write(reply.stderr);
    process.exit(reply.exitCode);
  });
}

if (process.argv[1]?.endsWith("guard.ts")) runGuard(process.argv.slice(2));
