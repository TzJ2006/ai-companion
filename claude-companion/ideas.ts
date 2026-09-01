#!/usr/bin/env tsx
// The idea-graph engine. One file, one graph, six commands.
// Format spec: ./FORMAT.md
//
//   npx tsx ideas.ts check | next | show <id> | set <id> <status> | render | init
//
// ponytail: no package, no build step, no server. tsx runs it from source so a
// target repo needs nothing installed but this folder's `yaml` dependency.

import { readFileSync, writeFileSync, appendFileSync, renameSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { argv, exit, cwd, pid, platform, env } from "node:process";
import { parseDocument, type Document } from "yaml";

export type Status = "todo" | "doing" | "done" | "blocked";
const STATUSES: Status[] = ["todo", "doing", "done", "blocked"];

/**
 * A repo can host more than one agent's companion — ai-companion holds Claude's,
 * Codex's and Cursor's side by side. So: claim the plain filename when it is
 * free, and take an agent-suffixed one when somebody else already has it.
 * Whoever arrives first keeps the clean name; nobody ever overwrites anybody.
 *
 * The choice is made once and then sticks, because step 1 below sees the
 * suffixed file we already created. Ownership of the plain file is readable
 * from the `agent:` key we seed into it.
 */
export const AGENT = "claude";

const IDEAS_DIR = (projectDir: string) => join(projectDir, "ideas");

/** True when this repo's plain `ideas/graph.yaml` belongs to somebody else. */
export function nameIsTaken(projectDir: string): boolean {
  const dir = IDEAS_DIR(projectDir);
  if (existsSync(join(dir, `graph.${AGENT}.yaml`))) return true;   // already claimed suffixed
  const plain = join(dir, "graph.yaml");
  if (!existsSync(plain)) return false;                             // free — take it
  try {
    return !new RegExp(`^agent:\\s*["']?${AGENT}\\b`, "m").test(readFileSync(plain, "utf8"));
  } catch {
    return true;   // unreadable but present — assume it is someone else's
  }
}

/** `name` when the plain name is free, `name.<agent>.ext` when it is taken. */
export function agentName(projectDir: string, name: string): string {
  if (!nameIsTaken(projectDir)) return name;
  const dot = name.lastIndexOf(".");
  // Dotfiles (".approved") have no extension to split, so append the suffix.
  return dot > 0 ? `${name.slice(0, dot)}.${AGENT}${name.slice(dot)}` : `${name}.${AGENT}`;
}

export const graphPath = (projectDir: string) =>
  join(IDEAS_DIR(projectDir), agentName(projectDir, "graph.yaml"));

export interface CodeRef { file: string; symbol?: string; lines?: string }
export interface Verify { command?: string; pass?: string; manual?: string; signed_off?: string | null }
export interface LogEntry { date: string; by?: string; note: string }

export interface Idea {
  id: string;
  name: string;
  status?: Status;
  needs?: string[];
  what?: string; why?: string; expected?: string; how?: string; why_this_way?: string;
  code?: CodeRef[];
  verify?: Verify;
  future?: string;
  log?: LogEntry[];
}

export interface Graph {
  version?: number;
  project?: string;
  overview?: string;
  endpoints?: string[];
  ideas: Idea[];
}

// ─── loading ────────────────────────────────────────────────────────────────

export function load(file: string): { doc: Document; graph: Graph } {
  if (!existsSync(file)) {
    throw new Error(`no idea graph at ${file} — run \`ideas.ts init\` first`);
  }
  const doc = parseDocument(readFileSync(file, "utf8"));
  if (doc.errors.length > 0) throw new Error(`invalid YAML in ${file}: ${doc.errors[0].message}`);
  const graph = doc.toJSON() as Graph;
  if (!graph || !Array.isArray(graph.ideas)) throw new Error(`${file} has no \`ideas:\` list`);
  return { doc, graph };
}

/** Sleep without going async — the write path around it is all synchronous. */
function pauseSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Write back through the parsed Document so comments and formatting survive. */
function save(file: string, doc: Document): void {
  // A fixed `${file}.tmp` is itself a race: two processes saving at once write
  // the same scratch file and one of them renames the other's half-written
  // bytes over the graph. Scope it to this process, the way the Python
  // companion does.
  const tmp = `${file}.${pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  writeFileSync(tmp, String(doc));
  // rename is atomic, but on Windows it also fails outright when anything else
  // holds a handle on the target — an editor, a virus scanner, another hook.
  // Those three codes mean "busy", not "broken", so wait and try again.
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, file);   // atomic: a crash mid-write leaves the old graph intact
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (attempt >= 5 || !["EPERM", "EBUSY", "EACCES"].includes(code)) throw error;
      pauseSync(20 * (attempt + 1));
    }
  }
}

// ─── graph queries ──────────────────────────────────────────────────────────

export const byId = (g: Graph) => new Map(g.ideas.map((i) => [i.id, i]));

/** Who lists `id` in their `needs` — the "这个想法是哪些想法的前置" direction. */
export function dependents(g: Graph, id: string): string[] {
  return g.ideas.filter((i) => (i.needs ?? []).includes(id)).map((i) => i.id).sort();
}

/** todo ideas whose prerequisites are all done — literally the next-actions list. */
export function frontier(g: Graph): Idea[] {
  const map = byId(g);
  return g.ideas.filter((i) =>
    (i.status ?? "todo") === "todo" &&
    (i.needs ?? []).every((n) => map.get(n)?.status === "done"));
}

/** First cycle found, as the id path that closes it. Empty when acyclic. */
export function findCycle(g: Graph): string[] {
  const map = byId(g);
  const state = new Map<string, 0 | 1 | 2>();   // 0 unvisited, 1 on stack, 2 done
  const path: string[] = [];
  let cycle: string[] = [];

  const walk = (id: string): boolean => {
    if (state.get(id) === 1) { cycle = [...path.slice(path.indexOf(id)), id]; return true; }
    if (state.get(id) === 2) return false;
    state.set(id, 1); path.push(id);
    for (const need of map.get(id)?.needs ?? []) {
      if (map.has(need) && walk(need)) return true;
    }
    path.pop(); state.set(id, 2);
    return false;
  };
  for (const i of g.ideas) if (walk(i.id)) break;
  return cycle;
}

/** Ideas from which no endpoint is reachable — work that leads nowhere. */
export function orphans(g: Graph): string[] {
  const ends = new Set(g.endpoints ?? []);
  if (ends.size === 0) return [];
  // Walk backwards from the endpoints along `needs`; anything unvisited is an orphan.
  const map = byId(g);
  const reaching = new Set<string>();
  const stack = [...ends];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (reaching.has(id) || !map.has(id)) continue;
    reaching.add(id);
    stack.push(...(map.get(id)!.needs ?? []));
  }
  return g.ideas.filter((i) => !reaching.has(i.id)).map((i) => i.id).sort();
}

/**
 * Every idea after all of its prerequisites — the order this graph should be
 * read in, rather than the order somebody happened to append it in.
 *
 * Layered Kahn: emit the whole batch of ideas that are waiting for nothing,
 * sorted by id, then the batch that batch unlocks, and so on. "Layer first, id
 * second" is a different order from a FIFO queue and from always taking the
 * smallest available id — the three disagree, and only this one finishes every
 * foundation idea before starting anything built on top of them.
 *
 * Two contracts, both borrowed from the Python version so the three companions
 * agree: a `needs` pointing at an id that isn't here is skipped silently
 * (`check` is what reports those), and ideas stuck in a cycle come back as data
 * at the end rather than as an exception. Losing a node is worse than ordering
 * one badly — `render` draws whatever this returns.
 */
export function topoOrder(g: Graph): Idea[] {
  const present = new Set(g.ideas.map((i) => i.id));
  // Everything below counts by array index, never by id: `render` does not run
  // `check` first, so a duplicate id has to come out as two cards, not one.
  const waiting = g.ideas.map((i) => (i.needs ?? []).filter((n) => present.has(n)).length);
  const unlocks = new Map<string, number[]>();      // id → indexes waiting on it
  for (const [index, idea] of g.ideas.entries()) {
    for (const need of idea.needs ?? []) {
      if (!present.has(need)) continue;
      const list = unlocks.get(need);
      if (list) list.push(index); else unlocks.set(need, [index]);
    }
  }

  // Plain comparison, not localeCompare: a locale-aware sort would order the
  // same graph differently on different machines.
  const earlierId = (a: number, b: number) =>
    g.ideas[a].id < g.ideas[b].id ? -1 : g.ideas[a].id > g.ideas[b].id ? 1 : 0;

  const out: Idea[] = [];
  const emitted = new Set<number>();
  let layer = g.ideas.map((_, index) => index).filter((index) => waiting[index] === 0);

  while (layer.length > 0) {
    layer.sort(earlierId);
    const next: number[] = [];
    for (const index of layer) {
      out.push(g.ideas[index]);
      emitted.add(index);
      // Only at exactly 0, so a duplicate id cannot queue the same idea twice.
      for (const blocked of unlocks.get(g.ideas[index].id) ?? []) {
        if (--waiting[blocked] === 0) next.push(blocked);
      }
    }
    layer = next;
  }

  const stuck = g.ideas.map((_, index) => index).filter((index) => !emitted.has(index));
  stuck.sort(earlierId);
  return out.concat(stuck.map((index) => g.ideas[index]));
}

// ─── scan worklist ──────────────────────────────────────────────────────────
// /ccscan claims to read every file. This turns that claim into a checklist:
// build the list of files up front, and strike each one off when it is actually
// Read. The agent cannot cross a file off without issuing a Read on it, so the
// remaining count is a number rather than a promise.

export const worklistFile = (projectDir: string) =>
  join(IDEAS_DIR(projectDir), agentName(projectDir, ".scan-todo"));

/** The human-readable change record. Suffixed alongside the graph. */
export const logFile = (projectDir: string) =>
  join(IDEAS_DIR(projectDir), agentName(projectDir, "log.md"));

// Files whose content nobody needs to read to understand the project.
// `node_modules` is listed explicitly because a repo may *track* one (this is
// not hypothetical — ai-companion commits packages/ast/node_modules), and then
// `git ls-files` hands you a vendored dependency's C source to "read".
const SKIP = /\.(png|jpe?g|gif|svg|ico|webp|pdf|zip|gz|tar|woff2?|ttf|eot|mp[34]|mov|wasm|lock|min\.js|map)$|(^|\/)(node_modules|vendor|third_party|ideas)\/|(^|\/)package-lock\.json$/i;

/** Every file worth reading. `git ls-files` is the answer when it's available — */
/** it already knows about .gitignore, submodules and case. */
/**
 * Path prefixes to leave out of the scan, one per line in `ideas/.scanignore`.
 * Vendored skill packs and other agents' parallel work live inside the repo but
 * are not this project's ideas — and a scan you can never finish is a scan
 * nobody trusts. Prefix match only: no globs, because "exclude this directory"
 * is the whole need.
 */
export function scanIgnores(projectDir: string): string[] {
  const file = join(projectDir, "ideas", ".scanignore");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

export function listProjectFiles(projectDir: string): string[] {
  let files: string[];
  try {
    // --others --exclude-standard: tracked files alone would hide every file
    // that is present but not committed yet — i.e. exactly the work in progress
    // you most need to read. --exclude-standard still honours .gitignore.
    // -z: NUL-separated and unquoted. Without it git octal-escapes any path
    // with non-ASCII in it, and every such file silently fails to match a Read.
    files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { cwd: projectDir, encoding: "utf8" })
      .split("\0").filter(Boolean);
  } catch {
    files = walk(projectDir, projectDir);   // not a git repo — walk it
  }
  const ignores = scanIgnores(projectDir);
  return files
    .filter((f) => !SKIP.test(f) && !ignores.some((prefix) => f.startsWith(prefix)))
    .sort();
}

const IGNORE_DIRS = new Set([".git", "node_modules", "dist", "build", ".venv", "__pycache__", ".next", "target"]);

function walk(dir: string, root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".claude") continue;
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, root));
    else out.push(relative(root, full).replaceAll("\\", "/"));
  }
  return out;
}

/**
 * Where a real Read records that it happened. Append-only and never rewritten,
 * which is the whole fix: `strike` used to read the checklist, filter it and
 * write it back, so five hook processes running at once each wrote a copy of
 * the list as it looked before the other four — and four strikes vanished.
 */
export const doneFile = (projectDir: string) =>
  join(IDEAS_DIR(projectDir), agentName(projectDir, ".scan-done"));

/** The checklist as `scan` wrote it once: everything that was ever on it. */
function readChecklist(projectDir: string): string[] {
  const file = worklistFile(projectDir);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Paths already crossed off, lower-cased — path case is not identity here. */
function readStruck(projectDir: string): Set<string> {
  const file = doneFile(projectDir);
  if (!existsSync(file)) return new Set();
  return new Set(readFileSync(file, "utf8").split("\n")
    .map((l) => l.trim().toLowerCase()).filter(Boolean));
}

/** What is still unread: the checklist minus what has been struck off. */
export function readWorklist(projectDir: string): string[] {
  const struck = readStruck(projectDir);
  if (struck.size === 0) return readChecklist(projectDir);
  return readChecklist(projectDir).filter((f) => !struck.has(f.toLowerCase()));
}

export function writeWorklist(projectDir: string, files: string[]): void {
  mkdirSync(dirname(worklistFile(projectDir)), { recursive: true });
  writeFileSync(worklistFile(projectDir), files.join("\n") + (files.length > 0 ? "\n" : ""));
  // A fresh checklist beside a stale struck-off list would report every file as
  // already read — R7 switched off, silently. The two always move together.
  writeFileSync(doneFile(projectDir), "");
}

/**
 * Cross one file off. Returns how many are left in this call's own snapshot,
 * or -1 when there was nothing to cross off (no scan running, or this file was
 * never on the list). The two cases have to stay distinguishable: a bare count
 * makes "not on the list" and "struck, none left" both 0, and the guard decides
 * whether to log at all from exactly that difference.
 *
 * Returning the count is also why the guard no longer re-reads the list after
 * calling this — two processes that both re-read would both print the same
 * remaining number, which is the symptom this idea started from.
 *
 * ponytail: a partial Read (offset/limit) still counts. Tracking byte ranges
 * costs more than it catches; revisit if agents start gaming it.
 */
export function strike(projectDir: string, filePath: string): number {
  const checklist = readChecklist(projectDir);
  if (checklist.length === 0) return -1;                       // no scan running
  const target = relative(projectDir, resolve(filePath)).replaceAll("\\", "/");
  const key = target.toLowerCase();
  if (!checklist.some((f) => f.toLowerCase() === key)) return -1;   // not on the list

  const struck = readStruck(projectDir);
  if (struck.has(key)) return -1;                              // somebody already crossed it off

  // One append, one write call, one line. The OS places it at the current end
  // of the file, so N concurrent processes produce N intact records — no lock,
  // no retry, no read-modify-write. (Local disks only: append atomicity does
  // not hold on network shares. A line here is a path, far under a sector.)
  appendFileSync(doneFile(projectDir), target + "\n");
  // Count from a fresh read, taken after our own append: the set we loaded a
  // moment ago cannot see what other processes struck in between, and two
  // processes reporting the same remaining number is the symptom this idea
  // exists to remove. This read is for the number only — nothing is written
  // back, so it cannot lose anybody's record the way the old filter-and-rewrite did.
  const after = readStruck(projectDir);
  return checklist.filter((f) => !after.has(f.toLowerCase())).length;
}

// ─── check ──────────────────────────────────────────────────────────────────

export interface CheckResult { errors: string[]; warnings: string[] }

const PLANNING_FIELDS = ["what", "why", "expected", "how", "why_this_way", "future"] as const;

export function check(g: Graph, projectDir: string): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  const map = byId(g);

  for (const idea of g.ideas) {
    const at = idea.id || "(missing id)";
    if (!idea.id) errors.push(`an idea has no id`);
    else if (seen.has(idea.id)) errors.push(`${at}: duplicate id`);
    seen.add(idea.id);
    if (!idea.name) errors.push(`${at}: no name — the graph shows names, so it needs one`);

    const status = idea.status ?? "todo";
    if (!STATUSES.includes(status)) errors.push(`${at}: unknown status "${status}"`);

    for (const need of idea.needs ?? []) {
      if (!map.has(need)) errors.push(`${at}: needs unknown idea "${need}"`);
      if (need === idea.id) errors.push(`${at}: needs itself`);
    }

    for (const field of PLANNING_FIELDS) {
      if (!idea[field]) warnings.push(`${at}: unanswered — ${field}`);
    }

    // A done idea has to point at real code and a real check, or "done" means nothing.
    if (status === "done") {
      if (!idea.code?.length) errors.push(`${at}: done but no \`code\` — where is it?`);
      if (!idea.verify) errors.push(`${at}: done but no \`verify\` — how was it confirmed?`);
      if (idea.verify?.manual && !idea.verify.signed_off) {
        errors.push(`${at}: done on a manual check with no \`signed_off\` — a human must sign it`);
      }
      if (!idea.code?.some((c) => c.lines)) {
        warnings.push(`${at}: done but no line numbers in \`code\``);
      }
    }

    for (const ref of idea.code ?? []) {
      if (!ref.file) { errors.push(`${at}: a \`code\` entry has no file`); continue; }
      // Before it is built, `code.file` is a plan — the file is not supposed to
      // exist yet. Once done it must: question 6 is only worth anything if the
      // path resolves, and /ccfix trusts it.
      if (status === "done" && !existsSync(resolve(projectDir, ref.file))) {
        errors.push(`${at}: code file not found — ${ref.file}`);
      }
    }
  }

  const cycle = findCycle(g);
  if (cycle.length > 0) {
    errors.push(`cycle: ${cycle.join(" → ")} — these are one idea, merge them`);
  }

  for (const end of g.endpoints ?? []) {
    if (!map.has(end)) errors.push(`endpoint "${end}" is not an idea`);
  }
  if (!g.endpoints?.length) warnings.push(`no \`endpoints\` — nothing defines "done" for this project`);
  for (const id of orphans(g)) warnings.push(`${id}: no endpoint depends on this, directly or not`);

  // A graph built from a partial read looks complete, which is worse than
  // no graph at all. Say the number out loud.
  const unread = readWorklist(projectDir);
  if (unread.length > 0) {
    warnings.push(`扫描未完成：还有 ${unread.length} 个文件没被读过（\`ideas.ts scan\`）`);
  }

  return { errors, warnings };
}

// ─── set ────────────────────────────────────────────────────────────────────

export function setStatus(
  doc: Document, graph: Graph, id: string, status: Status,
  entry: { by?: string; note?: string; date: string },
): void {
  const index = graph.ideas.findIndex((i) => i.id === id);
  if (index < 0) throw new Error(`no idea with id ${id}`);
  if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join(" | ")}`);

  const idea = graph.ideas[index];
  if (status === "done") {
    if (!idea.code?.length) throw new Error(`${id}: cannot be done without \`code\` — say where it lives`);
    if (!idea.verify) throw new Error(`${id}: cannot be done without \`verify\``);
    if (idea.verify.manual && !idea.verify.signed_off) {
      throw new Error(`${id}: manual check — a human must fill \`verify.signed_off\` before done`);
    }
  }

  doc.setIn(["ideas", index, "status"], status);
  const log = (idea.log ?? []).concat({
    date: entry.date,
    ...(entry.by ? { by: entry.by } : {}),
    note: entry.note || `status → ${status}`,
  });
  doc.setIn(["ideas", index, "log"], log);
}

// ─── apply ──────────────────────────────────────────────────────────────────
// Take the envelope a person's browser edits produced and write it into the
// graph. Everything here is a pure function of (graph text, envelope): it
// returns the new text or a reason, and never touches the disk. The CLI does
// the I/O. That split is what makes "what happens to a broken change file"
// something a test can enumerate instead of something you find out in a repo.

export interface ApplyResult {
  ok: boolean;
  /** Why it was refused. Nothing is written when this is set. */
  reason?: string;
  /** The new graph text. Only present when ok. */
  text?: string;
  /** One line per applied operation, for the human to read before trusting it. */
  changed?: string[];
}

const CHANGE_VERSION = 1;

/** Editing one of these on a finished idea means the idea itself changed. */
const BEHAVIOUR_FIELDS = ["what", "expected", "how", "why_this_way", "verify"];

/** What a new idea may bring with it. Everything else is stripped — a change
 *  file must not be able to conjure a `done` idea with a forged signature. */
const NEW_IDEA_FIELDS = ["name", "what", "why", "expected", "how", "why_this_way", "future"];

const idNumber = (id: string) => {
  const m = /^I-(\d+)$/.exec(String(id));
  return m ? Number(m[1]) : NaN;
};
const formatId = (n: number) => `I-${String(n).padStart(3, "0")}`;

/** A prose value, kept in the folded block style the rest of the file uses. */
function proseNode(doc: Document, value: unknown) {
  const node = doc.createNode(String(value ?? ""));
  (node as { type?: string }).type = "BLOCK_FOLDED";
  return node;
}

/** `needs` stays on one line. A plain array turns `[ I-001 ]` into a three-line
 *  list and shifts every line below it — 444 changed lines on the real graph. */
function needsNode(doc: Document, ids: string[]) {
  const node = doc.createNode(ids) as { flow?: boolean };
  node.flow = true;
  return node;
}

export function applyChanges(source: string, envelope: unknown, today: string): ApplyResult {
  const env = envelope as { v?: number; ops?: Record<string, string>[]; baseDigest?: string };

  // Version first, before anything else is trusted — a half-understood change
  // file writes a broken graph, and a broken graph is what this all guards.
  if (!env || env.v !== CHANGE_VERSION) {
    return { ok: false, reason: `不认识的改动格式版本：${env?.v} —— 整体拒绝` };
  }
  const current = fingerprint(source);
  if (env.baseDigest !== current) {
    return {
      ok: false,
      reason: `想法图在这份改动写成之后被改过了（改动基于 ${env.baseDigest}，现在是 ${current}），整体拒绝`,
    };
  }

  const ops = (env.ops ?? []).map((o) => ({ ...o }));
  const doc = parseDocument(source);
  if (doc.errors.length > 0) return { ok: false, reason: `图本身就有语法错误：${doc.errors[0].message}` };

  const before = doc.toJSON() as Graph;
  const highest = before.ideas.reduce((m, i) => Math.max(m, idNumber(i.id) || 0), 0);
  // The counter is a rule, not a stored number that might be missing: a graph
  // that has never had one starts from whatever it has already used.
  let nextId = Number(( before as { next_id?: number }).next_id) || highest + 1;

  // ── hand out real ids, then rewrite every reference to a temporary one ────
  const real = new Map<string, string>();
  for (const op of ops) {
    if (op.op !== "add" || !op.tmp) continue;
    real.set(op.tmp, formatId(nextId));
    nextId += 1;
  }
  const resolve = (v: string | undefined) => (v && real.get(v)) || v;
  for (const op of ops) {
    for (const key of ["id", "tmp", "from", "to"]) {
      if (op[key] !== undefined) op[key] = resolve(op[key])!;
    }
  }
  const leftover = ops.find((o) => ["id", "tmp", "from", "to"].some((k) =>
    typeof o[k] === "string" && o[k].startsWith("tmp:")));
  if (leftover) {
    return { ok: false, reason: `改动里还剩没有发到编号的临时号（${leftover.op} 上的 ${
      ["id", "tmp", "from", "to"].map((k) => o_(leftover, k)).find((v) => v)}），整体拒绝` };
  }

  const changed: string[] = [];
  // Index by id, freshly, before each phase — a structural change moves things.
  const indexOf = (id: string) =>
    (doc.toJSON() as Graph).ideas.findIndex((i) => i.id === id);

  // ── phase 1: new ideas ───────────────────────────────────────────────────
  for (const op of ops) {
    if (op.op !== "add") continue;
    const fields = (op.fields ?? {}) as Record<string, unknown>;
    const node = doc.createNode({}) as { set(k: string, v: unknown): void };
    node.set("id", op.tmp);
    node.set("name", String(fields.name ?? ""));
    node.set("status", "todo");                  // never anything else
    node.set("needs", needsNode(doc, []));
    for (const f of NEW_IDEA_FIELDS) {
      if (f === "name" || fields[f] === undefined) continue;
      node.set(f, proseNode(doc, fields[f]));
    }
    doc.addIn(["ideas"], node);
    changed.push(`新建 ${op.tmp}「${String(fields.name ?? "")}」`);
  }

  // ── phase 2: fields and statuses ─────────────────────────────────────────
  for (const op of ops) {
    if (op.op !== "set" && op.op !== "status") continue;
    const index = indexOf(op.id!);
    if (index < 0) return { ok: false, reason: `改动指向不存在的想法 ${op.id}` };
    const idea = (doc.toJSON() as Graph).ideas[index];

    if (op.op === "status") {
      try {
        setStatus(doc, doc.toJSON() as Graph, op.id!, op.to as Status,
          { by: "apply", note: `网页上改的状态：${op.from} → ${op.to}`, date: today });
      } catch (error) {
        return { ok: false, reason: String(error instanceof Error ? error.message : error) };
      }
      changed.push(`${op.id} 状态 ${op.from} → ${op.to}`);
      continue;
    }

    doc.setIn(["ideas", index, op.field!], proseNode(doc, op.new));
    changed.push(`${op.id} · ${op.field}`);

    // A finished idea whose behaviour changed is not finished any more. Without
    // this, the guard waves through its code files (it short-circuits on done)
    // and the new idea gets built with no test and no approval.
    if (idea.status === "done" && BEHAVIOUR_FIELDS.includes(op.field!)) {
      doc.setIn(["ideas", index, "status"], "doing");
      const log = (idea.log ?? []).concat({
        date: today, by: "apply",
        note: `已完成的想法被改了 ${op.field}，自动降回 doing —— 测试先行、想清楚、人批准三条规则对它重新生效`,
      });
      doc.setIn(["ideas", index, "log"], log);
      changed.push(`${op.id} 因行为字段被改，降回 doing`);
    }
  }

  // ── phase 2b: signatures ─────────────────────────────────────────────────
  // A manual check is the one thing a machine may not conclude. What lands here
  // is the person's own sentence, in the same shape a hand-recorded signature
  // has always taken, so old and new entries read as the same kind of thing.
  for (const op of ops) {
    if (op.op !== "sign") continue;
    const index = indexOf(op.id!);
    if (index < 0) return { ok: false, reason: `要签字的想法 ${op.id} 不存在` };
    const idea = (doc.toJSON() as Graph).ideas[index];
    if (!idea.verify?.manual) {
      return { ok: false, reason: `${op.id} 的验证不是人工检查，签字对它没有意义` };
    }
    if (idea.verify.signed_off) {
      return {
        ok: false,
        reason: `${op.id} 已经签过字了（${idea.verify.signed_off}）——`
          + ` 谁能在什么情况下推翻别人的签字，是一件还没想清楚的事，这里先不覆盖`,
      };
    }
    const who = String(op.who ?? "").trim();
    const words = String(op.words ?? "").trim();
    // A blank signature is not a signature. The whole reason this field exists
    // is that somebody looked and said something.
    if (!who) return { ok: false, reason: `${op.id} 的签字没有名字 —— 查不到是谁签的记录没有意义` };
    if (!words) return { ok: false, reason: `${op.id} 的签字没有原话 —— 空白的签名等于没签` };

    doc.setIn(["ideas", index, "verify", "signed_off"],
      `${who} ${today} —— 人的原话：「${words}」；在网页上签的`);
    changed.push(`${op.id} 人工验证签字（${who}）`);
  }

  // ── phase 3: edges ───────────────────────────────────────────────────────
  for (const op of ops) {
    if (op.op !== "link" && op.op !== "unlink") continue;
    const index = indexOf(op.to!);
    if (index < 0) return { ok: false, reason: `改动给不存在的想法 ${op.to} 连边` };
    const needs = ((doc.toJSON() as Graph).ideas[index].needs ?? []).slice();
    const next = op.op === "link"
      ? (needs.includes(op.from!) ? needs : needs.concat(op.from!))
      : needs.filter((n) => n !== op.from);
    doc.setIn(["ideas", index, "needs"], needsNode(doc, next));
    changed.push(`${op.to} ${op.op === "link" ? "加上" : "去掉"}前置 ${op.from}`);
  }

  // ── phase 4: deletions, last, so no earlier index can shift ──────────────
  for (const op of ops) {
    if (op.op !== "remove") continue;
    const graph = doc.toJSON() as Graph;
    const index = graph.ideas.findIndex((i) => i.id === op.id);
    if (index < 0) return { ok: false, reason: `要删的想法 ${op.id} 不存在` };
    const dependents = graph.ideas.filter((i) => (i.needs ?? []).includes(op.id!)).map((i) => i.id);
    if (dependents.length > 0) {
      return { ok: false, reason: `${op.id} 还被 ${dependents.join("、")} 依赖着，不能删 —— 先断开那些前置` };
    }
    // A section heading sits on whatever comes after it. For the first idea it
    // is attached to the sequence itself, not to the node, so moving only the
    // node's own comment orphans the heading onto whoever becomes first.
    const seq = doc.getIn(["ideas"]) as { items: { commentBefore?: string }[]; commentBefore?: string };
    const doomed = seq.items[index];
    const carried = index === 0 ? seq.commentBefore : doomed?.commentBefore;
    doc.deleteIn(["ideas", index]);
    if (carried) {
      if (index === 0) seq.commentBefore = carried;
      else if (seq.items[index]) seq.items[index].commentBefore = carried;
    }
    changed.push(`删掉 ${op.id}`);
  }

  // The counter only ever goes up, so a deleted number is never handed out again.
  if (real.size > 0 || (before as { next_id?: number }).next_id !== undefined) {
    const top = doc.contents as { items?: { key?: { value?: string } }[] };
    const had = (top.items ?? []).some((p) => p.key?.value === "next_id");
    doc.setIn(["next_id"], nextId);
    // setIn appends a brand-new key at the very end — several hundred lines
    // below the ideas list, where nobody reading the file would look for it.
    // Put it up with the other top-level keys instead.
    if (!had && top.items) {
      const added = top.items.pop()!;
      const at = top.items.findIndex((p) => p.key?.value === "ideas");
      top.items.splice(at < 0 ? top.items.length : at, 0, added);
    }
  }

  // ── nothing reaches the disk until the whole graph still validates ───────
  const after = doc.toJSON() as Graph;
  if (!after || !Array.isArray(after.ideas)) return { ok: false, reason: "应用之后的图读不出来了" };
  const { errors } = check(after, ".");
  const real_errors = errors.filter((e) => !/code file not found/.test(e));
  if (real_errors.length > 0) {
    return { ok: false, reason: `应用之后图校验不过，整体放弃：\n  - ${real_errors.join("\n  - ")}` };
  }

  return { ok: true, text: String(doc), changed };
}

/** Small helper so the leftover-tmp message can name the offending value. */
const o_ = (op: Record<string, string>, key: string) =>
  typeof op[key] === "string" && op[key].startsWith("tmp:") ? op[key] : undefined;

// ─── render ─────────────────────────────────────────────────────────────────

const esc = (s: unknown = "") =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Inside an attribute a quote closes it, so `esc` alone is not enough there —
// an idea named `" onmouseover=...` would otherwise write its own attributes.
const attr = (s: unknown = "") => esc(s).replace(/"/g, "&quot;");

/**
 * The 12 hex digits that identify one exact version of the graph. Same recipe
 * as guard.ts's approval hash — newlines normalised first, so a CRLF checkout
 * and an LF one are the same graph.
 */
export const fingerprint = (text: string) =>
  createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex").slice(0, 12);

const NONE = "<span class='none'>—</span>";

/** The six prose answers a person can retype in the browser. */
const PROSE = [
  ["what", "是什么"], ["why", "为什么有这个想法"], ["expected", "预期结果"],
  ["how", "如何实现"], ["why_this_way", "为什么这样实现"], ["future", "未来怎么用"],
] as const;

/**
 * `source` is the graph file's exact text and `projectDir` the repo it lives
 * in. Both are optional so `render(g)` still works, but without them the page
 * cannot fingerprint what it is editing or namespace its drafts.
 */
/**
 * The one copy of "a graph, drawn as a flowchart". The engine evaluates this
 * text and the page is handed the same text — so there is no second version to
 * drift, and a wrapping rule changed here changes both sides at once.
 *
 * It is a string on purpose, not a function put through `Function.prototype
 * .toString()`. tsx compiles with esbuild's keepNames switched on and no way to
 * turn it off, so every named binding in a real function body comes out wrapped
 * in `__name(...)` — a free variable injected by the compiler, which is exactly
 * what a zero-closure function must not have. Worse, vitest's transform does not
 * do that, so the tests would stay green while the double-clicked page threw
 * `__name is not defined`. A string is data: no transform ever touches it.
 *
 * The cost is that this body is not type-checked. The test that evaluates the
 * page's copy in a bare scope and diffs it against this one is what covers that,
 * and it is why that test is not optional.
 */
const MERMAID_SOURCE_FN = `function buildMermaidSource(g) {
  var ideas = (g && g.ideas) || [];
  var present = new Set(ideas.map(function (i) { return i.id; }));
  var ends = new Set((g && g.endpoints) || []);
  var mid = function (id) { return "n_" + String(id).replace(/[^A-Za-z0-9]/g, "_"); };
  var cls = function (i) { return ends.has(i.id) ? "endpoint" : (i.status || "todo"); };
  var wrap = function (name, max) {
    max = max || 12;
    if (Array.from(name).length <= max) return name;
    var units = name.match(/[\\u3000-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef]|[^\\s\\u3000-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef]+|\\s+/g) || [name];
    var lines = [], line = "";
    for (var u = 0; u < units.length; u++) {
      if (line && Array.from(line + units[u]).length > max) { lines.push(line.trim()); line = ""; }
      line += units[u];
    }
    if (line.trim()) lines.push(line.trim());
    return lines.join("<br>");
  };
  var out = [
    "flowchart TD",
    "classDef done fill:#14532d,stroke:#86efac,color:#f0fdf4;",
    "classDef doing fill:#1e3a8a,stroke:#93c5fd,color:#eff6ff;",
    "classDef todo fill:#334155,stroke:#94a3b8,color:#f1f5f9,stroke-dasharray:5 3;",
    "classDef blocked fill:#7c2d12,stroke:#fdba74,color:#fff7ed,stroke-dasharray:2 2;",
    "classDef endpoint fill:#581c87,stroke:#d8b4fe,color:#faf5ff,stroke-width:3px;"
  ];
  for (var a = 0; a < ideas.length; a++) {
    out.push(mid(ideas[a].id) + '["' + wrap(String(ideas[a].name || ideas[a].id).replace(/["()<>]/g, "")) + '"]');
  }
  for (var b = 0; b < ideas.length; b++) {
    var needs = ideas[b].needs || [];
    for (var c = 0; c < needs.length; c++) {
      if (present.has(needs[c])) out.push(mid(needs[c]) + " --> " + mid(ideas[b].id));
    }
  }
  var buckets = {};
  for (var d = 0; d < ideas.length; d++) {
    var k = cls(ideas[d]);
    (buckets[k] = buckets[k] || []).push(mid(ideas[d].id));
  }
  var keys = Object.keys(buckets);
  for (var e = 0; e < keys.length; e++) out.push("class " + buckets[keys[e]].join(",") + " " + keys[e] + ";");
  for (var f = 0; f < ideas.length; f++) {
    out.push("click " + mid(ideas[f].id) + ' call nodeClick("' + ideas[f].id + '")');
  }
  return out.join("\\n");
}`;

/** The engine's handle on the shared source above. Same text, same behaviour. */
export const buildMermaidSource: (g: Graph) => string =
  new Function(`${MERMAID_SOURCE_FN}\nreturn buildMermaidSource;`)() as (g: Graph) => string;

/**
 * The book the page keeps of what a person changed. One ordered list of
 * operations — six kinds — wrapped in an envelope, and that same envelope is
 * both the browser's draft and the change file that reaches disk. One format,
 * not three.
 *
 * The shape it replaces was a table of "idea + field name → new value". That
 * cannot hold structural edits: a new idea has no id yet to key on, a deleted
 * one has no field name, and prerequisites are a list — which the old
 * comparison stringified on both sides, so dropping `needs` from two entries to
 * one compared `"I-001"` against `"I-001"` and recorded *no change at all*.
 *
 * A string for the same reason as the diagram source above: it ships to the
 * page as text, so no compiler ever rewrites it, and the tests exercise the
 * exact bytes the browser runs.
 */
const LEDGER_FN = `function createLedger(graph, baseDigest, project) {
  var VERSION = 1;
  var ideas = (graph && graph.ideas) || [];
  var original = {};
  for (var i = 0; i < ideas.length; i++) original[ideas[i].id] = ideas[i];

  var ops = [];
  var seq = 0;
  var isTmp = function (id) { return String(id).indexOf("tmp:") === 0; };
  var drop = function (pred) { ops = ops.filter(function (o) { return !pred(o); }); };
  var origField = function (id, field) {
    var idea = original[id];
    var v = idea ? idea[field] : undefined;
    return v === undefined || v === null ? "" : v;
  };
  var origNeeds = function (id) {
    var idea = original[id];
    return (idea && idea.needs) || [];
  };
  var hasEdge = function (from, to) { return origNeeds(to).indexOf(from) >= 0; };

  return {
    setField: function (id, field, value) {
      drop(function (o) { return o.op === "set" && o.id === id && o.field === field; });
      var old = origField(id, field);
      if (String(old) !== String(value)) ops.push({ op: "set", id: id, field: field, old: old, new: value });
    },
    setStatus: function (id, value) {
      drop(function (o) { return o.op === "status" && o.id === id; });
      var from = (original[id] && original[id].status) || "todo";
      if (from !== value) ops.push({ op: "status", id: id, from: from, to: value });
    },
    addIdea: function (fields) {
      var tmp = "tmp:" + (++seq);
      ops.push({ op: "add", tmp: tmp, fields: fields });
      return tmp;
    },
    removeIdea: function (id) {
      // A brand-new idea that never reached disk: drop it and everything that
      // referred to it, rather than handing the write-back two cancelling orders.
      if (isTmp(id)) {
        // Every kind, not most kinds: one op left behind carries a tmp id nobody
        // owns, and "any leftover tmp id rejects the whole file" is the
        // write-back's rule — so one forgotten draft would sink every other
        // edit submitted with it.
        drop(function (o) {
          return (o.op === "add" && o.tmp === id) ||
                 (o.op === "set" && o.id === id) ||
                 (o.op === "status" && o.id === id) ||
                 ((o.op === "link" || o.op === "unlink") && (o.from === id || o.to === id));
        });
        return;
      }
      drop(function (o) { return o.op === "remove" && o.id === id; });
      ops.push({ op: "remove", id: id });
    },
    link: function (from, to) {
      var pending = ops.some(function (o) { return o.op === "unlink" && o.from === from && o.to === to; });
      if (pending) { drop(function (o) { return o.op === "unlink" && o.from === from && o.to === to; }); return; }
      if (hasEdge(from, to)) return;
      if (ops.some(function (o) { return o.op === "link" && o.from === from && o.to === to; })) return;
      ops.push({ op: "link", from: from, to: to });
    },
    /** A person's own words, standing behind a check only a person can make. */
    sign: function (id, who, words) {
      if (!String(who || "").trim() || !String(words || "").trim()) return false;
      drop(function (o) { return o.op === "sign" && o.id === id; });
      ops.push({ op: "sign", id: id, who: String(who).trim(), words: String(words).trim() });
      return true;
    },
    unlink: function (from, to) {
      var pending = ops.some(function (o) { return o.op === "link" && o.from === from && o.to === to; });
      if (pending) { drop(function (o) { return o.op === "link" && o.from === from && o.to === to; }); return; }
      if (!hasEdge(from, to)) return;
      if (ops.some(function (o) { return o.op === "unlink" && o.from === from && o.to === to; })) return;
      ops.push({ op: "unlink", from: from, to: to });
    },
    /** What this idea's prerequisites look like with the pending edits applied. */
    needsOf: function (id) {
      var out = origNeeds(id).slice();
      for (var k = 0; k < ops.length; k++) {
        var o = ops[k];
        if (o.op === "unlink" && o.to === id) out = out.filter(function (n) { return n !== o.from; });
        if (o.op === "link" && o.to === id && out.indexOf(o.from) < 0) out.push(o.from);
      }
      return out;
    },
    ops: function () { return ops.slice(); },
    isEmpty: function () { return ops.length === 0; },
    envelope: function () {
      // baseDigest is carried through untouched — the page never computes it.
      return { v: VERSION, project: project, baseDigest: baseDigest, ops: ops.slice() };
    },
    load: function (env) {
      if (!env || env.v !== VERSION) throw new Error("不认识的改动格式版本：" + (env && env.v));
      ops = (env.ops || []).slice();
      for (var m = 0; m < ops.length; m++) {
        if (ops[m].op === "add") seq = Math.max(seq, Number(String(ops[m].tmp).slice(4)) || 0);
      }
      // Stale is reported, never decided here: a draft written against an older
      // graph is the caller's problem to surface, not this book's to discard.
      return { stale: env.baseDigest !== baseDigest, count: ops.length };
    },
  };
}`;

export interface LedgerOp {
  op: "set" | "status" | "add" | "remove" | "link" | "unlink";
  id?: string; field?: string; old?: unknown; new?: unknown;
  from?: string; to?: string; tmp?: string; fields?: Record<string, string>;
}
export interface Ledger {
  setField(id: string, field: string, value: string): void;
  setStatus(id: string, value: string): void;
  addIdea(fields: Record<string, string>): string;
  removeIdea(id: string): void;
  sign(id: string, who: string, words: string): boolean;
  link(from: string, to: string): void;
  unlink(from: string, to: string): void;
  needsOf(id: string): string[];
  ops(): LedgerOp[];
  isEmpty(): boolean;
  envelope(): { v: number; project: string; baseDigest: string; ops: LedgerOp[] };
  load(env: unknown): { stale: boolean; count: number };
}

/** The engine's handle on the shared ledger source. Same text, same behaviour. */
export const createLedger: (graph: Graph, baseDigest: string, project: string) => Ledger =
  new Function(`${LEDGER_FN}\nreturn createLedger;`)() as never;

export function render(g: Graph, source = "", projectDir = "", token = ""): string {
  const map = byId(g);
  const ends = new Set(g.endpoints ?? []);
  const cls = (i: Idea) => (ends.has(i.id) ? "endpoint" : i.status ?? "todo");

  // The graph itself shows names only — detail lives one click away.
  const mermaid = buildMermaidSource(g);

  const links = (ids: string[]) => ids.length === 0 ? NONE : ids.map((id) =>
    `<a class="xlink" href="#${esc(id)}" data-goto="${esc(id)}">${esc(map.get(id)?.name ?? id)}</a>`).join(" ");

  // One prerequisite, with the cross that cuts it. The page rebuilds this block
  // whenever an edge changes, so the same shape is written in both places.
  const needChip = (from: string, to: string) =>
    `<span class="chip"><a class="xlink" href="#${esc(from)}" data-goto="${esc(from)}">${
      esc(map.get(from)?.name ?? from)}</a><button class="cut" title="断开这条前置" data-unlink-from="${
      attr(from)}" data-unlink-to="${attr(to)}">×</button></span>`;

  /** Everything not already a prerequisite of `id`, and not `id` itself. */
  const linkPicker = (i: Idea) => `<select class="rw-edge" data-link-to="${attr(i.id)}">
    <option value="">＋ 连一条前置…</option>${g.ideas
      .filter((o) => o.id !== i.id && !(i.needs ?? []).includes(o.id))
      .map((o) => `<option value="${attr(o.id)}">${esc(o.name || o.id)}</option>`).join("")}</select>`;

  const codeOf = (i: Idea) => !i.code?.length ? "<span class='none'>尚未实现</span>"
    : i.code.map((c) => `<code>${esc(c.file)}${c.lines ? ":" + esc(c.lines) : ""}</code>${c.symbol ? ` · ${esc(c.symbol)}` : ""}`).join("<br>");

  const verifyOf = (i: Idea) => {
    const v = i.verify;
    if (!v) return NONE;
    if (v.command) return `<code>${esc(v.command)}</code>${v.pass ? ` → ${esc(v.pass)}` : ""}`;
    // The sign button appears only where a signature would mean something: a
    // manual check nobody has signed yet. `data-manual` carries the exact
    // sentence, so the panel can show what is being attested to.
    const sign = v.signed_off ? "" :
      `<button class="sign-open" data-sign="${attr(i.id)}" data-manual="${attr(v.manual)}">人工签字</button>`;
    return `${esc(v.manual)}<br><span class="signoff">人工签字：${
      v.signed_off ? esc(v.signed_off) : "未签"}</span>${sign}`;
  };

  /**
   * The same predicate the sign button uses, deliberately not a second one.
   * Two predicates that disagree produce "the index says sign this, the card
   * has no button" — which reads as a broken page, not as a mismatch.
   */
  const awaitingSignature = (i: Idea) => !!i.verify && !i.verify.command && !i.verify.signed_off;

  /**
   * One collapsed worklist under the diagram. Native <details>, the same
   * element the per-card change log already uses: no script, and the browser
   * gives keyboard access, screen-reader semantics and find-in-page expansion
   * for free. Collapsed by default means *omitting* the attribute — `open="false"`
   * renders open.
   *
   * Every row keeps a real `href="#id"`. The smooth-scroll helper lives in the
   * module that imports the diagram library over the network, so on a
   * double-clicked page with no connection it never runs; the anchor is the only
   * route that works in every case. Rows never carry the sign button's marker —
   * this list sits above the cards, and a second one would silently capture the
   * lookups the signing tests do.
   */
  /**
   * The prerequisites still standing in this idea's way. "not done" rather than
   * "is todo" on purpose: a blocked or in-progress prerequisite blocks just as
   * hard, and an `=== "todo"` filter would quietly report that nothing is in the
   * way. That mistake would not show on this repo's own graph, so only a test
   * can catch it.
   */
  const waitingOn = (i: Idea) =>
    (i.needs ?? []).filter((n) => map.has(n) && map.get(n)!.status !== "done");

  const worklist = (title: string, rows: { id: string; name: string; note: string }[]) =>
    rows.length === 0 ? "" : `<details class="worklist"><summary>${esc(title)} (${rows.length})</summary>
  ${rows.map((r) => `<div class="wl-row"><a class="xlink" href="#${esc(r.id)}" data-goto="${
      esc(r.id)}">${esc(r.name)}</a><span class="wl-note">${esc(r.note)}</span></div>`).join("\n  ")}
</details>`;

  const STATUS_ZH: Record<string, string> = { todo: "待办", doing: "进行中", done: "已完成", blocked: "受阻" };
  const counts = STATUSES.map((s) => `${STATUS_ZH[s]} ${g.ideas.filter((i) => (i.status ?? "todo") === s).length}`).join(" · ");

  // Every editable field ships twice: the prose a reader sees, and the input a
  // writer types into. CSS shows one or the other; no text is ever built from
  // HTML at runtime, which is what keeps a hostile idea name inert.
  const field = (i: Idea, name: string, label: string) => `
    <dt>${label}</dt><dd data-f="${name}"><span class="ro">${esc(i[name as keyof Idea]) || NONE}</span
      ><textarea class="rw" data-idea="${attr(i.id)}" data-field="${name}" rows="3">${esc(i[name as keyof Idea] ?? "")}</textarea></dd>`;

  const statusPicker = (i: Idea) => `<select class="rw" data-idea="${attr(i.id)}" data-field="status">${
    STATUSES.map((s) => `<option value="${s}"${(i.status ?? "todo") === s ? " selected" : ""}>${STATUS_ZH[s]}</option>`).join("")}</select>`;

  const card = (i: Idea) => `<section class="idea ${cls(i)}" id="${esc(i.id)}">
  <h3><span class="ro">${esc(i.name)}</span><input class="rw" data-idea="${attr(i.id)}" data-field="name" value="${attr(i.name)}"> <span class="badge ro">${esc(STATUS_ZH[i.status ?? "todo"])}</span>${statusPicker(i)}${ends.has(i.id) ? '<span class="badge end">终点</span>' : ""}<button class="edit-toggle" data-edit="${attr(i.id)}">编辑</button><button class="edit-toggle danger" data-remove="${attr(i.id)}" title="标记待删，再点一次撤销">删除</button><span class="iid">${esc(i.id)}</span></h3>
  <dl>${PROSE.slice(0, 5).map(([name, label]) => field(i, name, label)).join("")}
    <dt>代码在哪</dt><dd>${codeOf(i)}</dd>
    <dt>如何验证</dt><dd>${verifyOf(i)}</dd>${field(i, "future", "未来怎么用")}
  </dl>
  <p class="edges needs" data-needs-of="${attr(i.id)}"><b>前置想法</b> <span class="chips">${
    (i.needs ?? []).filter((n) => map.has(n)).map((n) => needChip(n, i.id)).join("") || NONE
  }</span>${linkPicker(i)}</p>
  <p class="edges"><b>它是这些想法的前置</b> ${links(dependents(g, i.id))}</p>
  ${i.log?.length ? `<details class="log"><summary>修改记录 (${i.log.length})</summary>${i.log.map((l) =>
    `<div>${esc(l.date)}${l.by ? " · " + esc(l.by) : ""} — ${esc(l.note)}</div>`).join("")}</details>` : ""}
</section>`;

  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(g.project ?? "idea graph")} — 想法图</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif; margin:0 auto; max-width:1060px;
    padding:28px 22px 80px; background:#0b0f14; color:#e6edf3; }
  h1 { margin:0 0 6px; font-size:22px; }
  .overview { color:#93a1b0; margin:0 0 18px; }
  .legend { font-size:13px; color:#7d8896; margin:0 0 4px; }
  .sw { display:inline-block; width:11px; height:11px; border-radius:3px; vertical-align:-1px; margin:0 5px 0 12px; }
  .sw:first-child { margin-left:0; }
  .graph { background:#0d1117; border:1px solid #1f2933; border-radius:10px; margin:14px 0 26px; position:relative; }
  /* Pan/zoom: the viewport clips, the canvas is what gets transformed. */
  .viewport { overflow:hidden; height:min(72vh,760px); touch-action:none; cursor:grab; border-radius:10px; }
  .viewport.dragging { cursor:grabbing; }
  /* Only ever translated — never scaled. A CSS scale() would rasterise the
     layer once and stretch that bitmap, which is exactly what looks blurry. */
  .canvas { transform-origin:0 0; will-change:transform; display:inline-block; padding:0; line-height:0; }
  .canvas svg { max-width:none !important; display:block; }
  .graph-tools { position:absolute; top:10px; right:10px; z-index:2; display:flex; gap:4px; align-items:center;
    background:#0d1117cc; border:1px solid #1f2933; border-radius:8px; padding:4px 6px; backdrop-filter:blur(4px); }
  .graph-tools button { width:26px; height:24px; font-size:13px; line-height:1; cursor:pointer;
    background:#161b22; color:#c3ced9; border:1px solid #232c36; border-radius:5px; padding:0; }
  .graph-tools button:hover { border-color:#7dd3fc; color:#7dd3fc; }
  .graph-tools button.wide { width:auto; padding:0 8px; font-size:12px; }
  .zoom-level { font-size:11px; color:#7d8896; min-width:38px; text-align:right; font-variant-numeric:tabular-nums; }
  .graph-hint { font-size:11px; color:#5c6773; padding:0 14px 10px; }
  h2 { border-bottom:1px solid #1f2933; padding-bottom:7px; font-size:17px; margin-top:34px; }
  .idea { border:1px solid #1f2933; border-left:4px solid #475569; border-radius:9px;
    padding:14px 18px; margin:12px 0; scroll-margin-top:14px; }
  .idea.done { border-left-color:#14532d; } .idea.doing { border-left-color:#1e3a8a; }
  .idea.blocked { border-left-color:#7c2d12; } .idea.endpoint { border-left-color:#581c87; }
  .idea h3 { margin:0 0 10px; font-size:16px; }
  .idea.flash { animation: flash 1.2s ease-out; }
  @keyframes flash { from { background:#1d4ed855; } to { background:transparent; } }
  .badge { font-size:11px; padding:2px 8px; border-radius:10px; background:#1f2933; color:#93a1b0;
    font-weight:normal; margin-left:8px; }
  .badge.end { background:#581c87; color:#faf5ff; }
  .iid { float:right; font-size:12px; color:#5c6773; font-weight:normal; }
  dl { margin:0; display:grid; grid-template-columns:max-content 1fr; gap:5px 18px; }
  dt { color:#7d8896; white-space:nowrap; } dd { margin:0; }
  code { background:#161b22; border-radius:4px; padding:1px 6px; font-size:13px; }
  .none { color:#4b5563; }
  .signoff { font-size:12px; color:#7d8896; }
  .edges { margin:11px 0 0; font-size:13px; }
  .edges b { color:#7d8896; font-weight:normal; margin-right:4px; }
  .xlink { display:inline-block; background:#161b22; border:1px solid #1f2933; border-radius:5px;
    padding:1px 8px; margin:2px 4px 2px 0; color:#7dd3fc; text-decoration:none; font-size:12px; }
  .xlink:hover { border-color:#7dd3fc; }
  .log { margin:10px 0 0; font-size:12px; color:#7d8896; }
  .log summary { cursor:pointer; } .log div { margin:4px 0 0 14px; }

  /* ── editing ── read view and write view swap; only one is ever displayed. */
  .rw { display:none; }
  .idea.editing .ro { display:none; }
  .idea.editing .rw { display:inline-block; }
  .idea.editing dd .rw { display:block; }
  textarea.rw, input.rw, select.rw { width:100%; font:inherit; font-size:14px; color:#e6edf3;
    background:#0d1117; border:1px solid #30363d; border-radius:6px; padding:6px 8px; resize:vertical; }
  input.rw { width:auto; min-width:min(24em,100%); font-size:16px; }
  select.rw { width:auto; font-size:12px; padding:2px 6px; }
  textarea.rw:focus, input.rw:focus, select.rw:focus { outline:none; border-color:#7dd3fc; }
  .edit-toggle { margin-left:8px; font:inherit; font-size:11px; cursor:pointer; padding:2px 9px;
    background:#161b22; color:#93a1b0; border:1px solid #232c36; border-radius:10px; }
  .edit-toggle:hover { border-color:#7dd3fc; color:#7dd3fc; }
  /* 改过的地方要看得见 —— 提交之前，这是唯一的「哪里动过」的线索。 */
  .dirty > .rw, h3.dirty .rw { border-color:#eab308; background:#1c1917; }
  dd.dirty::after { content:"已改"; font-size:11px; color:#eab308; margin-left:6px; }
  .idea.dirty { border-left-color:#eab308; }
  #draft-banner, #restore { border:1px solid #3f3f18; background:#1c1917; color:#fde68a;
    border-radius:9px; padding:10px 14px; margin:0 0 14px; font-size:13px; }
  #restore { border-color:#4c1d95; background:#16121f; color:#ddd6fe; }
  #restore-list div { display:flex; gap:9px; align-items:center; margin:7px 0 0; }
  #restore-list span { flex:1; color:#a5a2b8; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  #restore button, #draft-banner button { font:inherit; font-size:11px; cursor:pointer; padding:2px 9px;
    background:#161b22; color:#c3ced9; border:1px solid #232c36; border-radius:10px; }
  #restore button:hover, #draft-banner button:hover { border-color:#7dd3fc; color:#7dd3fc; }

  /* ── structure editing ── edges, new ideas, pending deletions. */
  .chip { display:inline-flex; align-items:center; gap:2px; margin:2px 4px 2px 0; }
  .chip .xlink { margin:0; border-top-right-radius:0; border-bottom-right-radius:0; }
  .cut { font:inherit; font-size:11px; line-height:1; cursor:pointer; padding:2px 6px;
    background:#161b22; color:#7d8896; border:1px solid #1f2933; border-left:0;
    border-radius:0 5px 5px 0; }
  .cut:hover { color:#fca5a5; border-color:#7f1d1d; }
  select.rw-edge { font:inherit; font-size:11px; margin-left:6px; padding:2px 6px; color:#93a1b0;
    background:#0d1117; border:1px solid #232c36; border-radius:10px; cursor:pointer; }
  select.rw-edge:hover { border-color:#7dd3fc; color:#7dd3fc; }
  #new-idea { font:inherit; font-size:12px; cursor:pointer; padding:3px 11px; margin-left:10px;
    background:#161b22; color:#93a1b0; border:1px solid #232c36; border-radius:11px; vertical-align:2px; }
  #new-idea:hover { border-color:#7dd3fc; color:#7dd3fc; }
  .edit-toggle.danger:hover { border-color:#fca5a5; color:#fca5a5; }
  /* 待删是标记，不是消失 —— 人要能看见自己删了什么，并且改主意。 */
  .idea.removing { opacity:.55; border-left-color:#7f1d1d; }
  .idea.removing h3 > .ro, .idea.removing h3 > .rw { text-decoration:line-through; }
  .idea.incomplete { border-left-color:#a16207; }
  .idea.incomplete::before { content:"前三问还没填齐，提交时不会带上它"; display:block;
    font-size:11px; color:#eab308; margin:0 0 6px; }
  /* ── worklists under the diagram ── */
  .worklist { border:1px solid #1f2933; background:#0d1117; border-radius:9px;
    padding:9px 14px; margin:0 0 12px; font-size:13px; }
  .worklist > summary { cursor:pointer; color:#93a1b0; }
  .worklist > summary:hover { color:#7dd3fc; }
  .wl-row { display:flex; gap:10px; align-items:baseline; margin:7px 0 0; }
  .wl-row .xlink { margin:0; flex:none; }
  .wl-note { color:#7d8896; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

  #offline-note { border:1px solid #3f3f18; background:#1c1917; color:#fde68a;
    border-radius:9px; padding:10px 14px; margin:0 0 14px; font-size:13px; }

  /* ── submitting ── */
  #submit { font:inherit; font-size:11px; cursor:pointer; padding:2px 11px; margin-left:10px;
    background:#14532d; color:#f0fdf4; border:1px solid #166534; border-radius:10px; }
  #submit:hover:not(:disabled) { border-color:#86efac; }
  #submit:disabled { background:#161b22; color:#4b5563; border-color:#232c36; cursor:default; }
  #submit-panel { border:1px solid #1f3a2a; background:#0f1a14; color:#d7e6dc;
    border-radius:9px; padding:12px 16px; margin:0 0 14px; font-size:13px; }
  #submit-panel ul { margin:8px 0; padding-left:20px; }
  #submit-panel li { margin:2px 0; color:#a7c4b5; }
  #submit-panel button { font:inherit; font-size:12px; cursor:pointer; padding:3px 12px; margin-top:8px;
    background:#14532d; color:#f0fdf4; border:1px solid #166534; border-radius:10px; }
  #submit-panel button:hover { border-color:#86efac; }
  #submit-panel textarea { width:100%; margin-top:8px; font-family:ui-monospace,monospace; font-size:11px;
    color:#e6edf3; background:#0d1117; border:1px solid #30363d; border-radius:6px; padding:6px 8px; }
  #submit-panel code { font-size:12px; }

  /* ── signing a manual check ── */
  .sign-open { font:inherit; font-size:11px; cursor:pointer; padding:2px 9px; margin-left:8px;
    background:#161b22; color:#c084fc; border:1px solid #3b2a52; border-radius:10px; }
  .sign-open:hover { border-color:#c084fc; }
  #sign-panel { border:1px solid #3b2a52; background:#150f1c; color:#e2d9ee;
    border-radius:9px; padding:12px 16px; margin:0 0 14px; font-size:13px; }
  #sign-panel .what { color:#c9b8dd; margin:6px 0 10px; padding-left:10px; border-left:2px solid #3b2a52; }
  #sign-panel label { display:block; margin:8px 0 3px; font-size:12px; color:#a89bb8; }
  #sign-panel input, #sign-panel textarea { width:100%; font:inherit; font-size:13px; color:#e6edf3;
    background:#0d1117; border:1px solid #30363d; border-radius:6px; padding:6px 8px; }
  #sign-panel button { font:inherit; font-size:12px; cursor:pointer; padding:3px 12px; margin-top:10px;
    background:#4c1d95; color:#f5f3ff; border:1px solid #6d28d9; border-radius:10px; }
  #sign-panel button:hover { border-color:#c084fc; }
  #sign-panel .warn { color:#fca5a5; font-size:12px; margin-top:6px; }
</style></head><body>
<h1>${esc(g.project ?? "idea graph")} — 想法图</h1>
<p class="overview">${esc(g.overview)}</p>
<div id="restore" hidden>发现 <b><span id="restore-count">0</span></b> 处未提交的改动（上次关掉页面时没有提交）。
  逐条确认要不要恢复 —— 本地网页的存储不止这一页能写，所以这一步不会自动做：
  <div id="restore-list"></div></div>
<div id="draft-banner" hidden><b><span id="draft-count">0</span></b> 处未提交的改动<span id="draft-note"></span>
  <button id="submit" disabled>提交</button></div>
<div id="submit-panel" hidden></div>
<div id="sign-panel" hidden></div>
<p class="legend">
  <i class="sw" style="background:#14532d"></i>已完成
  <i class="sw" style="background:#1e3a8a"></i>进行中
  <i class="sw" style="background:#334155"></i>待办
  <i class="sw" style="background:#7c2d12"></i>受阻
  <i class="sw" style="background:#581c87"></i>终点
  · ${esc(counts)} · 点击任意节点查看详情
</p>
<div class="graph">
  <div class="graph-tools">
    <button data-zoom="out" title="缩小">−</button>
    <button data-zoom="in" title="放大">＋</button>
    <button data-zoom="fit" class="wide" title="适应窗口">适应</button>
    <button data-zoom="reset" class="wide" title="回到 100%">1:1</button>
    <span class="zoom-level">100%</span>
  </div>
  <div class="viewport"><div class="canvas"><pre class="mermaid">${mermaid}</pre></div></div>
</div>
<p class="graph-hint">滚轮缩放（以光标为中心）· 拖拽平移 · 点击节点看详情</p>
${worklist("待人工验证", g.ideas.filter(awaitingSignature).map((i) => ({
  id: i.id, name: i.name, note: i.verify?.manual ?? "",
})))}
${worklist("进行中", g.ideas.filter((i) => i.status === "doing").map((i) => {
  const waiting = waitingOn(i).map((n) => map.get(n)!.name || n);
  // A plain sentence, not the dash that means "no information": this says one
  // definite thing — no other idea is in the way. It does NOT say somebody is
  // working on it. Two of this repo's three in-progress ideas wait on nothing
  // and are both sitting on an unsigned manual check.
  return { id: i.id, name: i.name, note: waiting.length ? `在等 ${waiting.join("、")}` : "没有前置挡着它" };
}))}
<h2>想法详情 <button id="new-idea">＋ 新建想法</button></h2>
<div id="offline-note" hidden>图暂时不可用（离线，画图要联网取一个第三方库）—— 编辑与提交照常。</div>
<div id="cards">
${g.ideas.map(card).join("\n")}
</div>
<!-- The same text the engine ran to draw the diagram above. A classic script,
     so it defines one global both module scripts below can reach. -->
<script id="mermaid-source-fn">${MERMAID_SOURCE_FN}</script>
<script id="ledger-fn">${LEDGER_FN}</script>
<script type="application/json" id="graph-data" data-fingerprint="${attr(source ? fingerprint(source) : "")}" data-draft-key="aidev-ideas-draft:${attr(projectDir ? fingerprint(projectDir) : "")}" data-project="${attr(projectDir)}" data-token="${attr(token)}">${
  // The page's one data model. `<` is escaped so no idea's text can close this
  // tag, and the type keeps the browser from executing it whatever it holds.
  JSON.stringify(g).replace(/</g, "\\u003c")}</script>
<script type="module">
  // ── editing ───────────────────────────────────────────────────────────────
  // Its own module: if the mermaid CDN above is unreachable, that import throws
  // and takes its whole module with it — editing must not go down with it.
  const dataEl = document.getElementById("graph-data");
  const DATA = JSON.parse(dataEl.textContent);
  const DRAFT_KEY = dataEl.dataset.draftKey;
  const FINGERPRINT = dataEl.dataset.fingerprint;
  const PROJECT = dataEl.dataset.project || "";

  // One book for everything a person changes. It measures against the graph as
  // this page was written, so a field typed back to its old value stops being a
  // change; and its envelope is both the draft below and the file that will
  // reach disk — one format, not three.
  const ledger = createLedger(DATA, FINGERPRINT, PROJECT);
  let storageOk = true;

  const banner = document.getElementById("draft-banner");
  const count = document.getElementById("draft-count");
  const note = document.getElementById("draft-note");
  const inputFor = (id, f) => document.querySelector('[data-idea="' + id + '"][data-field="' + f + '"]');

  const touched = (id) => ledger.ops().some((o) =>
    o.id === id || o.tmp === id || o.from === id || o.to === id);

  const submitBtn = document.getElementById("submit");
  const panel = document.getElementById("submit-panel");

  function refresh() {
    count.textContent = String(ledger.ops().length);
    banner.hidden = ledger.isEmpty();
    note.textContent = storageOk ? "" : "（浏览器本地存储用不了，草稿只在内存里 —— 关页即丢）";
    if (submitBtn) submitBtn.disabled = ledger.isEmpty();
  }

  /** The single way a typed edit enters the book — typing or restoring. */
  function applyChange(id, f, value) {
    const el = inputFor(id, f);
    if (el) el.value = value;                    // .value / .textContent only — never as markup
    if (f === "status") ledger.setStatus(id, value); else ledger.setField(id, f, value);
    const dirty = ledger.ops().some((o) =>
      o.id === id && (o.field === f || (f === "status" && o.op === "status")));
    const box = el && (el.closest("[data-f]") || el.parentElement);
    if (box) box.classList.toggle("dirty", dirty);
    const card = document.getElementById(id);
    if (card) card.classList.toggle("dirty", touched(id));
    if (typeof markIncomplete === "function") markIncomplete(id);
    refresh();
    writeDraft();
  }

  // A draft is a safety net, never the transport: submitting reads the book.
  function writeDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(ledger.envelope()));
    } catch (e) { storageOk = false; refresh(); }
  }
  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) { storageOk = false; }
  }

  const onEdit = (e) => {
    const el = e.target;
    if (!el || !el.dataset || !el.dataset.field) return;
    applyChange(el.dataset.idea, el.dataset.field, el.value);
  };
  document.addEventListener("input", onEdit);
  document.addEventListener("change", onEdit);

  document.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => {
    const card = document.getElementById(b.getAttribute("data-edit"));
    b.textContent = card.classList.toggle("editing") ? "完成" : "编辑";
  }));

  /** One line a person can judge without opening anything. */
  function describeOp(o) {
    const trim = (s) => String(s === undefined || s === null ? "" : s).replace(/\\s+/g, " ").slice(0, 60);
    if (o.op === "set") return o.id + " · " + o.field + " → " + trim(o.new);
    if (o.op === "status") return o.id + " · 状态 " + o.from + " → " + o.to;
    if (o.op === "add") return "新建想法 · " + trim(o.fields && o.fields.name);
    if (o.op === "remove") return "删除想法 " + o.id;
    if (o.op === "link") return "连上前置 " + o.from + " → " + o.to;
    if (o.op === "unlink") return "断开前置 " + o.from + " → " + o.to;
    return o.op;
  }

  /** Put one restored operation back into the book, DOM included where there is one. */
  function restoreOp(o) {
    if (o.op === "set") { applyChange(o.id, o.field, o.new); return; }
    if (o.op === "status") { applyChange(o.id, "status", o.to); return; }
    if (o.op === "add") ledger.addIdea(o.fields);
    if (o.op === "remove") ledger.removeIdea(o.id);
    if (o.op === "link") ledger.link(o.from, o.to);
    if (o.op === "unlink") ledger.unlink(o.from, o.to);
    refresh();
    writeDraft();
  }

  // Defined after restoreOp on purpose: nothing between reading storage and the
  // human's click may put a draft into the book, and that ordering is what the
  // test asserts by slicing the script between the two.
  function readDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return { ops: [], stale: false };
      const env = JSON.parse(raw);
      // The stored digest is compared, not ignored: a draft written against an
      // older graph must say so before anyone puts it back.
      return { ops: (env && env.ops) || [], stale: !env || env.baseDigest !== FINGERPRINT };
    } catch (e) { storageOk = false; return { ops: [], stale: false }; }
  }

  // Restoring is never silent. Under file:// every local page shares one
  // storage area, so what is in there is not proof a person put it there.
  const draft = readDraft();
  if (draft.ops.length) {
    const panel = document.getElementById("restore");
    const list = document.getElementById("restore-list");
    document.getElementById("restore-count").textContent = String(draft.ops.length);
    if (draft.stale) {
      // Into the panel, NOT into the list. The done() helper below hides the
      // panel once the list is empty, so anything parked in the list that is
      // not a row keeps the count above zero forever — the panel never closes
      // and the draft is never cleared, so it returns on every reload.
      // (No backticks in here: this whole block lives inside a template
      // literal, and one would close it.)
      const warn = document.createElement("div");
      warn.className = "restore-warn";
      warn.textContent = "注意：这份草稿是对着另一个版本的图写的，恢复之前请逐条确认它是否还说得通。";
      panel.insertBefore(warn, list);
    }
    panel.hidden = false;
    const done = () => {
      if (list.children.length) return;
      panel.hidden = true;
      // Persist whatever ended up in the book, rather than wiping it: restoring
      // a row writes it to the draft, and clearing unconditionally right after
      // would lose exactly what was just restored on the next reload.
      if (ledger.isEmpty()) clearDraft(); else writeDraft();
    };
    for (const o of draft.ops) {
      const row = document.createElement("div");
      const label = document.createElement("span");
      label.textContent = describeOp(o);
      const yes = document.createElement("button");
      yes.textContent = "恢复";
      yes.setAttribute("data-restore", o.op);
      yes.addEventListener("click", () => { restoreOp(o); row.remove(); done(); });
      const no = document.createElement("button");
      no.textContent = "丢弃";
      no.addEventListener("click", () => { row.remove(); done(); });
      row.append(label, yes, no);
      list.append(row);
    }
  }

  // ── structure ─────────────────────────────────────────────────────────────
  const REQUIRED = ["name", "what", "why", "expected"];
  const addOp = (id) => ledger.ops().find((o) => o.op === "add" && o.tmp === id);

  /** A field's value with everything in the book applied. */
  function effectiveField(id, f) {
    const set = ledger.ops().filter((o) => o.op === "set" && o.id === id && o.field === f).pop();
    if (set) return set.new;
    const add = addOp(id);
    if (add) return (add.fields && add.fields[f]) || "";
    const idea = DATA.ideas.find((i) => i.id === id);
    return (idea && idea[f]) || "";
  }
  const nameOf = (id) => effectiveField(id, "name") || id;

  /** The graph as it would look with the whole book applied. */
  function snapshot() {
    const gone = new Set(ledger.ops().filter((o) => o.op === "remove").map((o) => o.id));
    const out = [];
    for (const idea of DATA.ideas) {
      if (gone.has(idea.id)) continue;
      const patched = Object.assign({}, idea);
      for (const o of ledger.ops()) {
        if (o.op === "set" && o.id === idea.id) patched[o.field] = o.new;
        if (o.op === "status" && o.id === idea.id) patched.status = o.to;
      }
      patched.needs = ledger.needsOf(idea.id);
      out.push(patched);
    }
    for (const o of ledger.ops()) {
      if (o.op !== "add") continue;
      out.push({ id: o.tmp, name: nameOf(o.tmp), status: "todo", needs: ledger.needsOf(o.tmp) });
    }
    return { version: DATA.version, endpoints: DATA.endpoints, ideas: out };
  }

  // The diagram module may never arrive (it loads from a CDN). Empty its source
  // out of the page right now: an undrawn block shows the raw flowchart text as
  // body copy, which is worse than showing nothing at all.
  const pre = document.querySelector("pre.mermaid");
  if (pre) pre.textContent = "";
  const offline = document.getElementById("offline-note");

  window.currentMermaidSource = () => buildMermaidSource(snapshot());
  window.graphReady = () => { if (offline) offline.hidden = true; };

  function redraw() {
    if (typeof window.redrawGraph === "function") { window.redrawGraph(window.currentMermaidSource()); return; }
    if (offline) offline.hidden = false;
  }

  function markIncomplete(id) {
    const c = document.getElementById(id);
    if (!c || !addOp(id)) return;
    c.classList.toggle("incomplete", REQUIRED.some((f) => !String(effectiveField(id, f)).trim()));
  }

  /** Rebuild one card's prerequisite chips from the book. */
  function renderNeeds(id) {
    const box = document.querySelector('[data-needs-of="' + id + '"] .chips');
    if (!box) return;
    const needs = ledger.needsOf(id);
    box.replaceChildren();
    if (!needs.length) {
      const dash = document.createElement("span");
      dash.className = "none"; dash.textContent = "—";
      box.append(dash);
      return;
    }
    for (const n of needs) {
      const chip = document.createElement("span");
      chip.className = "chip";
      const a = document.createElement("a");
      a.className = "xlink"; a.href = "#" + n;
      a.setAttribute("data-goto", n);
      a.textContent = nameOf(n);
      const cut = document.createElement("button");
      cut.className = "cut"; cut.textContent = "×";
      cut.title = "断开这条前置";
      cut.setAttribute("data-unlink-from", n);
      cut.setAttribute("data-unlink-to", id);
      chip.append(a, cut);
      box.append(chip);
    }
  }

  function afterStructure(id) {
    if (id) renderNeeds(id);
    refresh();
    writeDraft();
    redraw();
  }

  // Delegated, so rebuilt chips and freshly created cards need no re-wiring.
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!t || !t.getAttribute) return;
    const from = t.getAttribute("data-unlink-from");
    if (from) {
      const to = t.getAttribute("data-unlink-to");
      ledger.unlink(from, to);
      afterStructure(to);
      return;
    }
    const rm = t.getAttribute("data-remove");
    if (rm) {
      const c = document.getElementById(rm);
      const pending = ledger.ops().some((o) => o.op === "remove" && o.id === rm);
      // Marked, not gone — and a second click takes it back.
      if (pending) {
        ledger.load({ v: 1, project: PROJECT, baseDigest: FINGERPRINT,
          ops: ledger.ops().filter((o) => !(o.op === "remove" && o.id === rm)) });
      } else {
        ledger.removeIdea(rm);
      }
      if (c) c.classList.toggle("removing", !pending);
      afterStructure(null);
    }
  });

  document.addEventListener("change", (e) => {
    const t = e.target;
    const to = t && t.getAttribute && t.getAttribute("data-link-to");
    if (!to || !t.value) return;
    ledger.link(t.value, to);
    t.value = "";
    afterStructure(to);
  });

  // ── signing a manual check ────────────────────────────────────────────────
  // The one conclusion a machine may not reach. What makes this a signature
  // rather than a ritual is that the person types a sentence: a checkbox would
  // record only that somebody clicked, where a sentence records what they
  // judged. And the panel shows the check being signed, because signing a
  // blank page and signing a specific claim are not the same act.
  const signPanel = document.getElementById("sign-panel");
  const WHO_KEY = DRAFT_KEY + ":who";

  document.addEventListener("click", (e) => {
    const t = e.target;
    const id = t && t.getAttribute && t.getAttribute("data-sign");
    if (!id) return;

    let remembered = "";
    try { remembered = localStorage.getItem(WHO_KEY) || ""; } catch (err) { /* fine without it */ }

    signPanel.hidden = false;
    signPanel.replaceChildren();
    const head = document.createElement("div");
    head.textContent = "给 " + id + " 的人工验证签字。你要签的是这件事：";
    const what = document.createElement("div");
    what.className = "what";
    what.textContent = t.getAttribute("data-manual") || "";
    const whoLabel = document.createElement("label");
    whoLabel.textContent = "你的名字";
    const who = document.createElement("input");
    who.id = "sign-who";
    who.value = remembered;
    const wordsLabel = document.createElement("label");
    wordsLabel.textContent = "你自己的话 —— 你看到了什么、凭什么说它过了";
    const words = document.createElement("textarea");
    words.id = "sign-words";
    words.rows = 3;
    const go = document.createElement("button");
    go.id = "sign-go";
    go.textContent = "签字";
    const warn = document.createElement("div");
    warn.className = "warn";

    go.addEventListener("click", () => {
      // Refused here as well as in the engine: a blank signature should not get
      // as far as the change file.
      if (!ledger.sign(id, who.value, words.value)) {
        warn.textContent = "名字和话都得填 —— 空白的签名等于没签。";
        return;
      }
      try { localStorage.setItem(WHO_KEY, String(who.value).trim()); } catch (err) { /* fine */ }
      signPanel.hidden = true;
      refresh();
      writeDraft();
    });

    signPanel.append(head, what, whoLabel, who, wordsLabel, words, go, warn);
    signPanel.scrollIntoView({ block: "center" });
  });

  // ── submitting ────────────────────────────────────────────────────────────
  // Two roads out, carrying the same envelope: a request when a local service
  // is up, a file when there isn't one. The probe must fail quietly — the copy
  // somebody opened by double-clicking takes that road every time.
  const TOKEN = dataEl.dataset.token || "";

  function say(text) {
    panel.hidden = false;
    panel.replaceChildren();
    const line = document.createElement("div");
    line.textContent = text;
    panel.append(line);
    return panel;
  }

  async function haveServer() {
    if (!TOKEN) return false;                  // no token means nobody served this page
    try {
      const r = await fetch("/health");
      return (await r.json()).ok === true;
    } catch (e) { return false; }
  }

  async function post(envelope, confirm) {
    const r = await fetch("/changes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: TOKEN, confirm: confirm, envelope: envelope }),
    });
    return await r.json();
  }

  /** No service: hand the envelope over as a file, and say what to do with it. */
  function handOverFile(envelope) {
    const text = JSON.stringify(envelope, null, 2);
    const box = say("这台机器上没有开着本地服务，所以改动存成了一个文件。");
    const how = document.createElement("div");
    how.textContent = "把它放进 " + (PROJECT || "<项目目录>") + "/ideas/ ，然后跑："
      + " npx tsx claude-companion/ideas.ts apply";
    // The last tier is a textarea on purpose: a download can be blocked and the
    // clipboard is often unavailable under file://, but selecting text in a box
    // cannot fail. The only requirement of a fallback is that it never fails.
    const area = document.createElement("textarea");
    area.id = "submit-text";
    area.rows = 8;
    area.value = text;
    box.append(how, area);
    try {
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "changes.json";
      document.body.append(a);                 // must be in the document before the click
      a.click();
      a.remove();
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 1000);
    } catch (e) { /* blocked download is fine — the box above is always there */ }
  }

  async function submitChanges() {
    if (ledger.isEmpty()) return;
    const envelope = ledger.envelope();
    if (!(await haveServer())) { handOverFile(envelope); return; }

    const preview = await post(envelope, false);
    if (!preview.ok) { say("写回被拒：" + preview.reason); return; }

    const box = say("这一次会写进图里的改动：");
    const list = document.createElement("ul");
    for (const line of preview.changed || []) {
      const li = document.createElement("li");
      li.textContent = line;
      list.append(li);
    }
    const go = document.createElement("button");
    go.id = "confirm-write";
    go.textContent = "确认，写进图里";
    go.addEventListener("click", async () => {
      const done = await post(envelope, true);
      if (!done.ok) { say("写回被拒：" + done.reason); return; }
      // The draft is deliberately left alone. A write-back can still be refused
      // later, and the person's edits must not be the thing that gets destroyed.
      say("已提交，写回了 " + (done.changed || []).length + " 处改动。刷新页面就能看到新图。");
      const again = document.createElement("button");
      again.textContent = "刷新页面";
      again.addEventListener("click", () => { try { location.reload(); } catch (e) {} });
      panel.append(again);
    });
    box.append(list, go);
  }

  if (submitBtn) submitBtn.addEventListener("click", () => { submitChanges(); });

  document.getElementById("new-idea").addEventListener("click", () => {
    const tmp = ledger.addIdea({ name: "", what: "", why: "", expected: "" });
    const proto = document.querySelector(".idea");
    const el = proto.cloneNode(true);
    el.id = tmp;
    el.className = "idea todo editing";
    for (const attrName of ["data-idea", "data-edit", "data-remove", "data-needs-of", "data-link-to"]) {
      for (const n of el.querySelectorAll("[" + attrName + "]")) n.setAttribute(attrName, tmp);
    }
    for (const n of el.querySelectorAll("textarea, input")) n.value = "";
    for (const n of el.querySelectorAll(".ro")) n.textContent = "";
    for (const n of el.querySelectorAll(".iid")) n.textContent = tmp;
    for (const n of el.querySelectorAll("select.rw")) n.value = "todo";
    for (const n of el.querySelectorAll(".chips")) n.replaceChildren();
    // 「代码在哪」「如何验证」这类只读格没有 .ro，上面几行够不着它们，
    // 新想法会带着上一张卡片的代码路径和验证命令出生 —— 而那正是 /ccbuild
    // 照着去写文件的两样东西。按「不是可编辑字段的格一律清空」来清，
    // 以后再加只读格也不会漏。
    for (const n of el.querySelectorAll("dd:not([data-f])")) n.textContent = "—";
    for (const n of el.querySelectorAll(".log, .badge.end")) n.remove();
    document.getElementById("cards").append(el);
    markIncomplete(tmp);
    afterStructure(tmp);
  });

  refresh();
</script>
<script type="module">
  // ── the diagram ───────────────────────────────────────────────────────────
  // Last on purpose: this module fetches from a CDN and awaits at the top level,
  // so anything after it would not initialise until the network answered.
  // Editing above must never wait on that.
  import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
  // ELK packs big graphs far tighter than the default dagre and routes edges
  // with fewer crossings; if its CDN module fails to load, dagre still renders.
  let layout = "dagre";
  try {
    const elk = await import("https://cdn.jsdelivr.net/npm/@mermaid-js/layout-elk@0/dist/mermaid-layout-elk.esm.min.mjs");
    mermaid.registerLayoutLoaders(elk.default);
    layout = "elk";
  } catch (e) { console.warn("ELK layout unavailable, falling back to dagre", e); }
  mermaid.initialize({
    startOnLoad: false, securityLevel: "loose", theme: "dark", layout,
    elk: { mergeEdges: true, nodePlacementStrategy: "LINEAR_SEGMENTS" },
    flowchart: { nodeSpacing: 30, rankSpacing: 55, curve: "basis", padding: 8 },
  });

  // ── pan / zoom ────────────────────────────────────────────────────────────
  // Plain CSS transform on a wrapper: no library, no dependency, and the SVG
  // stays a real SVG so mermaid's node clicks keep working.
  const viewport = document.querySelector(".viewport");
  const canvas = document.querySelector(".canvas");
  const readout = document.querySelector(".zoom-level");
  const MIN = 0.15, MAX = 6;
  let k = 1, tx = 0, ty = 0;

  const clamp = (v) => Math.min(MAX, Math.max(MIN, v));

  /** The diagram's own coordinate size, from the viewBox — CSS cannot skew it. */
  function natural() {
    const svg = canvas.querySelector("svg");
    const box = svg && svg.viewBox && svg.viewBox.baseVal;
    return box && box.width ? { svg, w: box.width, h: box.height } : null;
  }

  function apply() {
    // Zoom by resizing the SVG so the vectors are re-rendered at that size, and
    // pan by translating the wrapper. Translation alone never blurs.
    const n = natural();
    if (n) { n.svg.style.width = n.w * k + "px"; n.svg.style.height = n.h * k + "px"; }
    canvas.style.transform = \`translate(\${tx}px, \${ty}px)\`;
    readout.textContent = Math.round(k * 100) + "%";
  }
  /** Zoom about a point in viewport coordinates, so the cursor stays put. */
  function zoomAt(px, py, factor) {
    const next = clamp(k * factor);
    if (next === k) return;
    tx = px - (px - tx) * (next / k);
    ty = py - (py - ty) * (next / k);
    k = next;
    apply();
  }
  function fit() {
    const n = natural();
    if (!n) return;
    const view = viewport.getBoundingClientRect();
    // Shrink to fit, never enlarge: blowing a small diagram up to 235% is not
    // what "fit" means to anyone looking at a flowchart. Centre it either way.
    k = clamp(Math.min(1, (view.width - 28) / n.w, (view.height - 28) / n.h));
    tx = (view.width - n.w * k) / 2;
    ty = (view.height - n.h * k) / 2;
    apply();
  }

  viewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  let dragging = false, lastX = 0, lastY = 0, moved = 0;
  viewport.addEventListener("pointerdown", (e) => {
    dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY;
    viewport.classList.add("dragging");
  });
  viewport.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    // Capture only once it is really a drag. Capturing on pointerdown retargets
    // the whole compatibility mouse sequence — including click — to .viewport,
    // so mermaid's per-node handler never fires and nodes stop opening cards.
    if (moved > 4 && !viewport.hasPointerCapture(e.pointerId)) viewport.setPointerCapture(e.pointerId);
    tx += dx; ty += dy; lastX = e.clientX; lastY = e.clientY;
    apply();
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    viewport.classList.remove("dragging");
    // A drag must not also register as a node click; a tap (< 4px) still should.
    if (moved > 4) { e.preventDefault(); e.stopPropagation(); }
  };
  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);

  document.querySelectorAll(".graph-tools button").forEach((b) => {
    b.addEventListener("click", () => {
      const r = viewport.getBoundingClientRect();
      const action = b.getAttribute("data-zoom");
      if (action === "in") zoomAt(r.width / 2, r.height / 2, 1.25);
      else if (action === "out") zoomAt(r.width / 2, r.height / 2, 0.8);
      else if (action === "fit") fit();
      else { k = 1; tx = 0; ty = 0; apply(); }
    });
  });

  function gotoNode(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
  }
  window.nodeClick = gotoNode;
  document.querySelectorAll("[data-goto]").forEach((a) =>
    a.addEventListener("click", (e) => { e.preventDefault(); gotoNode(a.getAttribute("data-goto")); }));

  /** Draw one source. mermaid stamps what it has processed, so replace the node. */
  async function draw(src) {
    const host = document.querySelector(".canvas");
    const pre = document.createElement("pre");
    pre.className = "mermaid";
    pre.textContent = src;                       // never markup
    host.replaceChildren(pre);
    await mermaid.run({ nodes: [pre] });
    for (let i = 0; i < 120 && !natural(); i++) await new Promise(requestAnimationFrame);
  }

  await draw(window.currentMermaidSource());
  fit();
  // The one bridge to the editing module above — the same trick as nodeClick.
  // It keeps the human's zoom and pan, because a redraw on every edit that
  // snapped back to the whole graph would make editing unusable.
  window.redrawGraph = (src) => { draw(src).then(() => apply()); };
  window.graphReady();
  new ResizeObserver(() => { if (k === 1 && tx === 0 && ty === 0) fit(); }).observe(viewport);
</script></body></html>`;
}

// ─── serve ──────────────────────────────────────────────────────────────────
// A local page that can actually save. Node's own http module, no framework:
// there are three routes, and a framework would be pure weight in an engine
// whose premise is that a target repo installs nothing.
//
// The security story is three cheap things, and it is worth being honest about
// what it is not. It binds the loopback address only, it mints a one-time token
// that exists solely inside the page it just served, and every write goes
// through the same `applyChanges` the command line uses — one write path, one
// set of checks, no chance of the two drifting apart. What it does NOT do is
// prove a change came from a person: the guard hangs off the editing tools and
// never sees Bash, so an agent could always drive the engine directly. This
// server is a better handle on a door that is already open, not a new door.

export interface Serving {
  host: string;
  port: number;
  token: string;
  url: string;
  close(): Promise<void>;
}

const DEFAULT_PORT = 8787;
const HOST = "127.0.0.1";

/** Read one JSON request body, with a ceiling so a bad client cannot eat memory. */
function readJson(req: NodeJS.ReadableStream): Promise<unknown> {
  return new Promise((done, fail) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 4_000_000) fail(new Error("改动文件太大了"));
    });
    req.on("end", () => { try { done(JSON.parse(raw || "null")); } catch (e) { fail(e as Error); } });
    req.on("error", fail);
  });
}

/** Listen on the first free port at or above `from`. */
function listenFrom(server: Server, from: number, tries = 20): Promise<number> {
  return new Promise((done, fail) => {
    const attempt = (port: number, left: number) => {
      // Both listeners come off on either outcome. Passing the callback to
      // listen() instead leaves a stale one-shot 'listening' handler behind
      // after EADDRINUSE, so the next successful attempt fires the *previous*
      // attempt's callback too — and the promise resolves with a port nothing
      // is listening on, which is a browser opening a dead address.
      const onError = (error: NodeJS.ErrnoException) => {
        server.removeListener("listening", onListening);
        if (error.code === "EADDRINUSE" && left > 0) { attempt(port + 1, left - 1); return; }
        fail(error);
      };
      const onListening = () => { server.removeListener("error", onError); done(port); };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, HOST);
    };
    attempt(from, tries);
  });
}

export async function serve(
  projectDir: string, file: string,
  opts: { port?: number; open?: boolean } = {},
): Promise<Serving> {
  const token = randomBytes(16).toString("hex");
  const send = (res: { writeHead(c: number, h: Record<string, string>): void; end(b?: string): void },
                code: number, body: unknown) => {
    const text = JSON.stringify(body);
    res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
    res.end(text);
  };

  const server = createServer(async (req, res) => {
    try {
      const path = (req.url ?? "/").split("?")[0];

      if (req.method === "GET" && path === "/health") { send(res, 200, { ok: true }); return; }

      if (req.method === "GET" && path === "/") {
        // Rendered on the spot, every time. There is no generated page on disk
        // in this mode, so there is nothing that can go stale.
        const text = readFileSync(file, "utf8");
        const graph = parseDocument(text).toJSON() as Graph;
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(render(graph, text, projectDir, token));
        return;
      }

      if (req.method === "POST" && path === "/changes") {
        const body = (await readJson(req)) as { token?: string; envelope?: unknown; confirm?: boolean };
        if (!body || body.token !== token) {
          send(res, 403, { ok: false, reason: "令牌不对 —— 这个服务只接受它自己发出去的那个页面" });
          return;
        }
        const source = readFileSync(file, "utf8");
        const today = new Date().toISOString().slice(0, 10);
        const result = applyChanges(source, body.envelope, today);
        if (!result.ok) { send(res, 200, { ok: false, reason: result.reason }); return; }

        // Two steps on one route: first tell the person exactly what would
        // happen, and only write once they have said yes.
        if (body.confirm !== true) { send(res, 200, { ok: true, preview: true, changed: result.changed }); return; }

        writeFileSync(file, result.text!);
        appendServeLog(projectDir, result.changed ?? []);
        const graph = parseDocument(result.text!).toJSON() as Graph;
        send(res, 200, { ok: true, changed: result.changed, graph });
        return;
      }

      send(res, 404, { ok: false, reason: "没有这个地址" });
    } catch (error) {
      send(res, 400, { ok: false, reason: String(error instanceof Error ? error.message : error) });
    }
  });

  const port = await listenFrom(server, opts.port ?? DEFAULT_PORT);
  const url = `http://${HOST}:${port}`;
  if (opts.open) openBrowser(url);

  return {
    host: HOST, port, token, url,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

/** Same trail as every other write — a change that reaches the graph is recorded. */
function appendServeLog(projectDir: string, changed: string[]): void {
  if (changed.length === 0) return;
  try {
    const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
    appendFileSync(logFile(projectDir),
      `- ${stamp}  网页写回 ${changed.length} 处：${changed.join("；")}\n`);
  } catch { /* logging must never be the reason a save fails */ }
}

/** How this platform opens a URL. Separate and exported so it is testable —
 *  the first version referenced a name that was never imported, and every test
 *  passed `open: false`, so the one path a person actually runs was the only
 *  one nothing covered. */
export function browserCommand(url: string): [string, string[]] {
  if (platform === "win32") return ["cmd", ["/c", "start", "", url]];
  if (platform === "darwin") return ["open", [url]];
  return ["xdg-open", [url]];
}

function openBrowser(url: string): void {
  // Everything inside the try, not just the spawn: opening a browser is a
  // convenience, and no failure in it may ever be the reason the server
  // does not come up.
  try {
    if (env.AIDEV_NO_BROWSER) return;
    const [cmd, args] = browserCommand(url);
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  } catch { /* no browser is not a reason to fail */ }
}

// ─── cli ────────────────────────────────────────────────────────────────────

// `agent:` is not decoration — it is how a graph says whose it is. Without it,
// the next call reads our own plain graph as somebody else's and switches to a
// suffixed file, quietly abandoning the graph we just wrote.
const SEED = `version: 1
agent: ${AGENT}
project: PROJECT_NAME
overview: >
  一段话说清这个项目在做什么。

# 终点：什么叫"这个项目做完了"。每个都是下面某个想法的 id。
endpoints: []

ideas: []
`;

/** `serve` keeps the process alive; every other command exits when it returns. */
const KEEP_RUNNING = -1;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Regenerate the page from what is on disk right now. */
function redraw(file: string, projectDir: string): string {
  const out = file.replace(/\.ya?ml$/, ".html");
  const text = readFileSync(file, "utf8");
  const graph = parseDocument(text).toJSON() as Graph;
  writeFileSync(out, render(graph, text, projectDir));
  return `wrote ${out} (${graph.ideas.length} ideas)`;
}

function main(args: string[]): number {
  const command = args[0];
  const projectDir = resolve(flag(args, "project") ?? cwd());
  const file = resolve(flag(args, "file") ?? graphPath(projectDir));
  // Callers pass the date in so the tool has no clock of its own to disagree with.
  const today = flag(args, "date") ?? new Date().toISOString().slice(0, 10);

  // `scan` runs before a graph exists, so it must not require one.
  if (command === "scan") {
    const all = listProjectFiles(projectDir);
    if (args.includes("--reset") || !existsSync(worklistFile(projectDir))) {
      writeWorklist(projectDir, all);   // also clears .scan-done — see writeWorklist
      console.log(`worklist: ${all.length} 个文件待读 → ${relative(projectDir, worklistFile(projectDir))}`);
    } else if (!existsSync(doneFile(projectDir))) {
      // One-time move to the append-only format. The old checklist held only
      // what was still unread, so what was read is everything else — and
      // reconciling against the real file list is what drops the torn line the
      // old read-modify-write left behind.
      const stillTodo = new Set(readChecklist(projectDir).map((f) => f.toLowerCase()));
      const already = all.filter((f) => !stillTodo.has(f.toLowerCase()));
      writeWorklist(projectDir, all);
      if (already.length > 0) appendFileSync(doneFile(projectDir), already.map((f) => `${f}\n`).join(""));
      console.log(`迁移到只追加的记录：${all.length} 个文件，其中 ${already.length} 个此前已读`);
    }
    const left = readWorklist(projectDir);
    const done = all.length - left.length;
    console.log(`已读 ${done}/${all.length}${left.length === 0 ? "  —  全部读完" : `，还剩 ${left.length}：`}`);
    // Print the next batch so the caller has something to act on, not just a
    // number. `--n 0` means all of them (that is what /ccscan asks for).
    const batch = Number(flag(args, "n") ?? 40);
    const shown = batch === 0 ? left : left.slice(0, batch);
    for (const file of shown) console.log(`  ${file}`);
    if (shown.length < left.length) console.log(`  … 还有 ${left.length - shown.length} 个（--n 0 看全部）`);
    return 0;
  }

  if (command === "init") {
    if (existsSync(file)) { console.log(`already there: ${file}`); return 0; }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, SEED.replace("PROJECT_NAME", projectDir.split(/[\\/]/).pop() ?? "project"));
    console.log(`created ${file}`);
    return 0;
  }

  const { doc, graph } = load(file);

  switch (command) {
    case "check": {
      const { errors, warnings } = check(graph, projectDir);
      for (const w of warnings) console.log(`warn  ${w}`);
      for (const e of errors) console.log(`ERROR ${e}`);
      console.log(`\n${graph.ideas.length} ideas · ${errors.length} errors · ${warnings.length} warnings`);
      return errors.length > 0 ? 1 : 0;
    }
    case "next": {
      const ready = frontier(graph);
      if (ready.length === 0) {
        const left = graph.ideas.filter((i) => (i.status ?? "todo") !== "done");
        console.log(left.length === 0 ? "everything is done." : "nothing is ready — every remaining idea is blocked or waiting:");
        for (const i of left) console.log(`  ${i.id}  ${i.name}  [${i.status ?? "todo"}]  needs ${(i.needs ?? []).join(", ") || "—"}`);
        return 0;
      }
      for (const i of ready) console.log(`${i.id}\t${i.name}`);
      return 0;
    }
    case "show": {
      const idea = byId(graph).get(args[1]);
      if (!idea) { console.error(`no idea with id ${args[1]}`); return 1; }
      const map = byId(graph);
      console.log(`${idea.id}  ${idea.name}  [${idea.status ?? "todo"}]`);
      for (const [label, value] of [
        ["1 是什么", idea.what], ["2 为什么有这个想法", idea.why], ["3 预期结果", idea.expected],
        ["4 如何实现", idea.how], ["5 为什么这样实现", idea.why_this_way],
        ["6 代码在哪", (idea.code ?? []).map((c) => `${c.file}${c.lines ? ":" + c.lines : ""}${c.symbol ? ` (${c.symbol})` : ""}`).join(", ")],
        ["7 如何验证", idea.verify?.command ?? idea.verify?.manual],
        ["8 未来怎么用", idea.future],
      ] as [string, string | undefined][]) {
        console.log(`\n${label}\n  ${(value || "—").trim().replace(/\n/g, "\n  ")}`);
      }
      console.log(`\n前置想法  ${(idea.needs ?? []).map((n) => `${n} (${map.get(n)?.status ?? "?"})`).join(", ") || "—"}`);
      console.log(`它是谁的前置  ${dependents(graph, idea.id).join(", ") || "—"}`);
      for (const l of idea.log ?? []) console.log(`  log ${l.date} ${l.by ?? ""} ${l.note}`);
      return 0;
    }
    case "set": {
      setStatus(doc, graph, args[1], args[2] as Status,
        { by: flag(args, "by"), note: flag(args, "note"), date: today });
      save(file, doc);
      // Re-render here too, so the page on disk is never a stale copy of a
      // graph somebody already changed.
      redraw(file, projectDir);
      console.log(`${args[1]} → ${args[2]}`);
      return 0;
    }
    case "render": {
      console.log(redraw(file, projectDir));
      return 0;
    }
    case "serve": {
      // Returns without exiting: the process stays up until Ctrl-C.
      serve(projectDir, file, {
        port: Number(flag(args, "port")) || undefined,
        open: !args.includes("--no-open"),
      }).then((live) => {
        console.log(`想法图开在 ${live.url}`);
        console.log(`在网页上改完点提交，改动直接写回 ${relative(projectDir, file)} —— 不用再搬文件。`);
        console.log(`按 Ctrl-C 结束。`);
      }).catch((error) => {
        console.error(`起不来：${error instanceof Error ? error.message : error}`);
        exit(1);
      });
      return KEEP_RUNNING;
    }
    case "apply": {
      // args[1] is the change file only when it is one — otherwise it is the
      // first flag, and treating a flag as a path prints a baffling error.
      const given = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
      const changeFile = resolve(given ?? join(IDEAS_DIR(projectDir), "changes.json"));
      if (!existsSync(changeFile)) {
        console.error(`没有找到改动文件：${changeFile}
（网页提交时如果没有本地服务，文件会落在下载目录 —— 把它移到 ideas/ 再跑一次）`);
        return 1;
      }
      let envelope: unknown;
      try { envelope = JSON.parse(readFileSync(changeFile, "utf8")); }
      catch (error) { console.error(`改动文件不是合法的 JSON：${error}`); return 1; }

      const result = applyChanges(readFileSync(file, "utf8"), envelope, today);
      if (!result.ok) {
        // Refused means refused: the change file stays exactly where it is, so
        // the person's edits are not the thing that gets destroyed.
        console.error(`拒绝写回：${result.reason}\n\n改动文件原样留在 ${changeFile}，没有动过。`);
        return 1;
      }
      writeFileSync(file, result.text!);
      for (const line of result.changed ?? []) console.log(`  ${line}`);
      console.log(`\n写回 ${result.changed?.length ?? 0} 处改动 → ${relative(projectDir, file)}`);
      const archived = changeFile.replace(/\.json$/, "") + `.applied-${today}.json`;
      try { renameSync(changeFile, archived); console.log(`改动文件已归档 → ${relative(projectDir, archived)}`); }
      catch { console.log(`（改动文件归档失败，它还在 ${changeFile}）`); }
      console.log(redraw(file, projectDir));
      console.log(`\n回浏览器刷新一下页面，再做下一轮。`);
      return 0;
    }
    default:
      console.error("usage: ideas.ts check | next | show <id> | set <id> <status> | render | serve | apply [file] | init | scan");
      console.error(`       [--file ideas/${agentName(cwd(), "graph.yaml")}] [--project .] [--by who] [--note text]`);
      return 2;
  }
}

if (argv[1]?.endsWith("ideas.ts")) {
  try {
    const code = main(argv.slice(2));
    if (code !== KEEP_RUNNING) exit(code);   // `serve` stays up until Ctrl-C
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    exit(1);
  }
}
