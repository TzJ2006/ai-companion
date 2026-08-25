// Shared write-gate. Used by ideas.ts (CLI) and hooks/gate.mjs (Cursor preToolUse).
// Keep this file plain Node ESM -- the hook cannot wait for tsx.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const WRITE_TOOLS = /^(Write|StrReplace|Delete|EditNotebook|ApplyPatch|search_replace)$/i;

export const AGENT = "cursor";

const PLAIN_LEDGER = new Set([
  "ideas/graph.yaml",
  "ideas/log.md",
  "ideas/graph.html",
]);

const HARNESS = [
  ".cursor/hooks.json",
  ".cursor/hooks/gate.mjs",
  ".cursor/hooks/record.mjs",
  ".cursor/hooks/session.mjs",
  ".cursor/companion.json",
];

export function norm(p) {
  return String(p ?? "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/** Owner stamped into a graph file as `agent: cursor` (or claude / codex). */
export function parseAgentKey(text) {
  const m = String(text ?? "").match(/^agent:\s*["']?([A-Za-z0-9_-]+)/m);
  return m ? m[1] : null;
}

/**
 * True when this agent must not use the plain `ideas/graph.yaml`.
 *
 * Sticky: once `graph.<agent>.yaml` exists we keep using it.
 * Occupied: the plain file exists and its `agent:` is someone else.
 * Unstamped leftover: Cursor used the plain name before `agent:` existed, so
 * Cursor claims it; Claude/Codex do not (they suffix instead).
 */
export function nameIsTaken(projectDir, agent = AGENT) {
  const dir = join(projectDir, "ideas");
  if (existsSync(join(dir, `graph.${agent}.yaml`))) return true;
  const plain = join(dir, "graph.yaml");
  if (!existsSync(plain)) return false;
  try {
    const owner = parseAgentKey(readFileSync(plain, "utf8"));
    if (!owner) return agent !== "cursor";
    return owner !== agent;
  } catch {
    return true;
  }
}

/** `name` when the plain name is free, `name.<agent>.ext` when it is taken. */
export function agentName(projectDir, name, agent = AGENT) {
  if (!nameIsTaken(projectDir, agent)) return name;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}.${agent}${name.slice(dot)}` : `${name}.${agent}`;
}

export function ledgerNames(projectDir, agent = AGENT) {
  const graph = agentName(projectDir, "graph.yaml", agent);
  const log = agentName(projectDir, "log.md", agent);
  return { graph, log, html: graph.replace(/\.ya?ml$/i, ".html") };
}

export function graphPath(projectDir, agent = AGENT) {
  return join(projectDir, "ideas", ledgerNames(projectDir, agent).graph);
}

export function logPath(projectDir, agent = AGENT) {
  return join(projectDir, "ideas", ledgerNames(projectDir, agent).log);
}

export function isWriteTool(name) {
  return WRITE_TOOLS.test(String(name ?? ""));
}

export function extractWritePath(toolName, input) {
  if (!isWriteTool(toolName)) return null;
  const i = input && typeof input === "object" ? input : {};
  const p = i.path ?? i.file_path ?? i.target_notebook ?? i.filePath ?? i.uri;
  return p ? String(p) : null;
}

export function isLedger(rel, projectDir) {
  const n = norm(rel);
  if (projectDir) {
    const { graph, log, html } = ledgerNames(projectDir);
    return [`ideas/${graph}`, `ideas/${log}`, `ideas/${html}`].map(norm).includes(n);
  }
  if (PLAIN_LEDGER.has(n)) return true;
  return /^ideas\/(graph\.[a-z0-9_-]+\.(ya?ml|html)|log\.[a-z0-9_-]+\.md)$/i.test(n);
}

export function isHarness(rel) {
  const n = norm(rel);
  return HARNESS.includes(n) || n === ".cursor/hooks.json";
}

/** `cursor-companion/**` or exact path. */
export function matchesExempt(rel, patterns) {
  const n = norm(rel);
  for (const raw of patterns ?? []) {
    const p = norm(raw);
    if (!p) continue;
    if (p.endsWith("/**")) {
      const prefix = p.slice(0, -3);
      if (n === prefix || n.startsWith(prefix + "/")) return true;
      continue;
    }
    if (p.endsWith("*")) {
      if (n.startsWith(p.slice(0, -1))) return true;
      continue;
    }
    if (n === p || n.endsWith("/" + p)) return true;
  }
  return false;
}

/** Repo-relative suffix match with path-segment boundaries. */
export function matchesFile(rel, key) {
  const n = norm(rel);
  const k = norm(key);
  if (!k || !n) return false;
  if (n === k) return true;
  return n.endsWith("/" + k);
}

export function isBuildReady(idea) {
  if (!String(idea?.expected ?? "").trim()) return "missing expected";
  if (!String(idea?.how ?? "").trim()) return "missing how";
  const v = idea?.verify;
  if (!v || !(v.command || v.manual)) return "missing verify";
  if (!idea?.code?.some((c) => c && c.file)) return "missing code.file (where the implementation will live)";
  return null;
}

export function verifyFiles(idea) {
  const cmd = idea?.verify?.command;
  if (!cmd) return [];
  return String(cmd).split(/\s+/).filter((t) => /[./\\]/.test(t) && !t.startsWith("-"));
}

export function ideaFiles(idea) {
  const files = (idea?.code ?? []).map((c) => c.file).filter(Boolean);
  return [...files, ...verifyFiles(idea)];
}

export function needsUnmet(idea, graph) {
  const map = new Map((graph?.ideas ?? []).map((i) => [i.id, i]));
  return (idea?.needs ?? []).filter((id) => map.get(id)?.status !== "done");
}

export function fileClash(idea, graph) {
  const mine = new Set(ideaFiles(idea).map(norm));
  const clashes = [];
  for (const other of graph?.ideas ?? []) {
    if (other.id === idea.id) continue;
    if ((other.status ?? "todo") !== "doing") continue;
    for (const f of ideaFiles(other)) {
      if (mine.has(norm(f))) clashes.push(`${other.id}:${f}`);
    }
  }
  return clashes;
}

export function unlockedFiles(graph) {
  const out = [];
  for (const idea of graph?.ideas ?? []) {
    if ((idea.status ?? "todo") !== "doing") continue;
    if (isBuildReady(idea)) continue;
    out.push({ id: idea.id, files: ideaFiles(idea) });
  }
  return out;
}

/**
 * @returns {{ allow: boolean, reason: string }}
 */
export function decideWrite(graph, rel, projectDir) {
  const n = norm(rel);
  if (!n) return { allow: false, reason: "no file path" };

  if (isLedger(n, projectDir)) {
    const names = projectDir
      ? ledgerNames(projectDir)
      : { graph: "graph.yaml", log: "log.md", html: "graph.html" };
    return { allow: true, reason: `ledger (ideas/${names.graph}|${names.log}|${names.html})` };
  }

  const enforce = graph?.enforce !== false;
  if (!enforce) return { allow: true, reason: "enforce: false" };

  if (matchesExempt(n, graph?.exempt)) return { allow: true, reason: `exempt ${n}` };

  if (isHarness(n)) {
    return { allow: false, reason: "harness files are locked ? a human turns enforce off, or edits cursor-companion/ then reinstalls" };
  }

  const unlocked = unlockedFiles(graph);
  if (unlocked.length === 0) {
    const doing = (graph?.ideas ?? []).filter((i) => (i.status ?? "todo") === "doing");
    if (doing.length === 0) {
      return { allow: false, reason: "no idea is doing ? /idea-discuss first, then ideas.ts set <id> doing" };
    }
    return {
      allow: false,
      reason: `doing but not build-ready: ${doing.map((i) => `${i.id} (${isBuildReady(i)})`).join("; ")}`,
    };
  }

  for (const u of unlocked) {
    if (u.files.some((f) => matchesFile(n, f))) {
      return { allow: true, reason: `${u.id} doing` };
    }
  }

  const listed = unlocked.flatMap((u) => u.files.map((f) => `${u.id}:${f}`)).join(", ");
  return { allow: false, reason: `not in the doing idea's code/verify files (${listed || "none"})` };
}
