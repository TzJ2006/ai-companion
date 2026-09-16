#!/usr/bin/env tsx
// The shared-base idea-graph engine (I-088). One file, ONE graph per project.
// Format spec: ./FORMAT.md — D10: the graph belongs to the project, not to an
// agent, so there is no agent-suffix file picking here. Legacy suffixed graphs
// (graph.claude.yaml, graph.cursor.yaml) are read-only migration inputs and
// this engine never touches them.
//
// What it answers is `SUBCOMMANDS` further down, and the usage text is
// generated off that list — no hand-copied second list up here, because the one
// that used to sit here had already drifted half a dozen subcommands behind.
// How it is invoked in a repository that installed it: `node <ENGINE_RELATIVE>
// <子命令>`, spelled once in manifests.ts and imported below (D14/D28).
//
// ponytail: no package, no build step. tsx runs it from source; the bundled
// dist/companion.mjs (I-096) is the same file with `yaml` baked in.

import { readFileSync, writeFileSync, appendFileSync, renameSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { execFileSync, spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createServer, type Server } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { argv, exit, cwd, pid, platform, env } from "node:process";
import { parseDocument, stringify, type Document } from "yaml";
import { ENGINE_RELATIVE } from "./manifests.js";
import { coordMain } from "./coordination.js";

/**
 * How a person actually invokes this engine in a repository that installed it
 * (D14): the single-file bundle, at the one path manifests.ts spells. Every
 * "去跑这个" the engine prints is built from here — `ideas.ts` is a source-tree
 * filename that does not exist in an installed repository, so naming it in a
 * message is pointing at nothing.
 */
const ENGINE_CMD = `node ${ENGINE_RELATIVE}`;

export type Status = "todo" | "doing" | "done" | "blocked";
const STATUSES: Status[] = ["todo", "doing", "done", "blocked"];

// resolve() at the boundary: hook events on Windows carry backslashed paths,
// and the docs' own advice is to normalise once before comparing, not per rule.
const IDEAS_DIR = (projectDir: string) => join(resolve(projectDir), "ideas");

/**
 * Every canonical location, from one function, so nobody ever guesses a
 * filename. No agent suffixes: D10 decided the graph is the project's.
 */
export interface CanonicalPaths {
  graph: string; html: string; log: string;
  worklist: string; done: string; approved: string; runtime: string;
  /** I-138: challenges (pending/) and receipts (receipts/) — tracked by git,
   *  so a challenge minted on one machine can be answered on another and the
   *  receipt travels back. Red/green evidence stays machine-local in runtime. */
  approvals: string;
}

export function paths(projectDir: string): CanonicalPaths {
  const ideas = IDEAS_DIR(projectDir);
  return {
    graph: join(ideas, "graph.yaml"),
    html: join(ideas, "graph.html"),
    log: join(ideas, "log.md"),
    worklist: join(ideas, ".scan-todo"),
    done: join(ideas, ".scan-done"),
    approved: join(ideas, ".approved"),
    runtime: join(ideas, ".runtime"),
    approvals: join(ideas, "approvals"),
  };
}

export const graphPath = (projectDir: string) => paths(projectDir).graph;

export interface CodeRef { file: string; symbol?: string; lines?: string }
// `test_files` is explicit (D31): paths are never guessed out of the command
// string — a path with a space or a flag in the command would guess wrong.
export interface Verify { command?: string; test_files?: string[]; pass?: string; manual?: string; signed_off?: string | null }
export interface LogEntry { date: string; by?: string; note: string }

export interface Idea {
  id: string;
  name: string;
  status?: Status;
  needs?: string[];
  parent?: string;                // the idea this one sits under; absent = top level (FORMAT.md, "The tree")
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
  next_id?: number;
  ideas: Idea[];
}

/** How many ideas a group holds, how many are finished, and how many sit in
 *  each status — ONE count for every legend on the page, so no two numbers
 *  can disagree (I-085). */
export function tally(ideas: Idea[]): { total: number; done: number; by: Record<Status, number> } {
  const by: Record<Status, number> = { todo: 0, doing: 0, done: 0, blocked: 0 };
  for (const i of ideas) by[(i.status ?? "todo") as Status] = (by[(i.status ?? "todo") as Status] ?? 0) + 1;
  return { total: ideas.length, done: by.done, by };
}

// ─── loading ────────────────────────────────────────────────────────────────

export function load(file: string): { doc: Document; graph: Graph } {
  if (!existsSync(file)) {
    throw new Error(`no idea graph at ${file} — run \`${ENGINE_CMD} init\` first`);
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

/**
 * D30: every generated file lands this way — the graph, the checklist, the
 * approval receipts, the red/green evidence, the rendered page. Write a scratch
 * file, then rename it over the target, so a crash or a second process leaves
 * the previous version whole instead of a truncated one.
 *
 * A fixed `${file}.tmp` would itself be the race: two processes writing at once
 * share the scratch name and one renames the other's half-written bytes into
 * place. Scope it to this process, the way the Python companion does.
 */
function atomicWrite(file: string, text: string): void {
  const tmp = `${file}.${pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  writeFileSync(tmp, text);
  // rename is atomic, but on Windows it also fails outright when anything else
  // holds a handle on the target — an editor, a virus scanner, another hook.
  // Those three codes mean "busy", not "broken", so wait and try again.
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, file);   // atomic: a crash mid-write leaves the old file intact
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (attempt >= 5 || !["EPERM", "EBUSY", "EACCES"].includes(code)) {
        rmFileQuietly(tmp);    // no scratch file left lying beside the target
        throw error;
      }
      pauseSync(20 * (attempt + 1));
    }
  }
}

/** Write back through the parsed Document so comments and formatting survive. */
function save(file: string, doc: Document): void {
  atomicWrite(file, String(doc));
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

export const worklistFile = (projectDir: string) => paths(projectDir).worklist;

/** The human-readable change record. */
export const logFile = (projectDir: string) => paths(projectDir).log;

// Files whose content nobody needs to read to understand the project, each
// paired with the reason the scan report has to be able to print (D29): a
// skipped file must be visible, because "not read" dressed up as "not there"
// is exactly the self-report the checklist exists to replace.
// `node_modules` is listed explicitly because a repo may *track* one (this is
// not hypothetical — ai-companion commits packages/ast/node_modules), and then
// `git ls-files` hands you a vendored dependency's C source to "read".
const SKIP_RULES: [RegExp, string][] = [
  [/\.(png|jpe?g|gif|svg|ico|webp|pdf|zip|gz|tar|woff2?|ttf|eot|mp[34]|mov|wasm)$/i, "二进制或资源文件，读它读不出内容"],
  [/\.(lock|min\.js|map)$|(^|\/)package-lock\.json$/i, "生成物（锁文件 / 压缩产物 / source map），源头在别处"],
  [/(^|\/)(node_modules|vendor|third_party)\//i, "第三方依赖，不是这个项目自己的代码"],
  [/(^|\/)ideas\//i, "账本目录，由引擎自己生成和维护"],
];

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

/** Everything this project contains, before any of the scan rules apply. */
function allProjectFiles(projectDir: string): string[] {
  try {
    // --others --exclude-standard: tracked files alone would hide every file
    // that is present but not committed yet — i.e. exactly the work in progress
    // you most need to read. --exclude-standard still honours .gitignore.
    // -z: NUL-separated and unquoted. Without it git octal-escapes any path
    // with non-ASCII in it, and every such file silently fails to match a Read.
    return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { cwd: projectDir, encoding: "utf8" })
      .split("\0").filter(Boolean);
  } catch {
    return walk(projectDir, projectDir);   // not a git repo — walk it
  }
}

/** Why one file is not on the checklist (D29). */
export interface SkippedFile { file: string; reason: string }

/** The reason this path is skipped, or null when it is not skipped at all. */
function skipReason(file: string, ignores: string[]): string | null {
  const prefix = ignores.find((p) => file.startsWith(p));
  if (prefix) return `ideas/.scanignore 里排除的前缀 ${prefix}`;
  return SKIP_RULES.find(([rule]) => rule.test(file))?.[1] ?? null;
}

/**
 * Everything the scan leaves out, each with the reason (D29). The checklist
 * alone answers "how much is left"; this answers "and what did you not even
 * put on it" — the half a scan report cannot honestly leave to a promise.
 */
export function skippedFiles(projectDir: string): SkippedFile[] {
  const ignores = scanIgnores(projectDir);
  return allProjectFiles(projectDir)
    .flatMap((file) => {
      const reason = skipReason(file, ignores);
      return reason ? [{ file, reason }] : [];
    })
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/** Every file worth reading — everything the project has, minus what one of the
 *  skip rules or `.scanignore` accounts for. `skippedFiles` names the rest. */
export function listProjectFiles(projectDir: string): string[] {
  const ignores = scanIgnores(projectDir);
  return allProjectFiles(projectDir)
    .filter((f) => skipReason(f, ignores) === null)
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
export const doneFile = (projectDir: string) => paths(projectDir).done;

/** The checklist as `scan` wrote it once: everything that was ever on it. */
function readChecklist(projectDir: string): string[] {
  const file = worklistFile(projectDir);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
}

/**
 * Struck entries, lower-cased path → content fingerprint (D12, I-099).
 * A line is `path<TAB>sha256`; a bare `path` is a legacy record and counts as
 * read with no fingerprint to check — old data is grandfathered, not punished.
 * Later lines win, so re-striking an edited file just appends a fresh record.
 */
function readStruck(projectDir: string): Map<string, string | null> {
  const file = doneFile(projectDir);
  const map = new Map<string, string | null>();
  if (!existsSync(file)) return map;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const tab = t.indexOf("\t");
    if (tab < 0) map.set(t.toLowerCase(), null);
    else map.set(t.slice(0, tab).toLowerCase(), t.slice(tab + 1));
  }
  return map;
}

function contentHash(projectDir: string, rel: string): string {
  try { return sha256(readFileSync(join(resolve(projectDir), rel), "utf8")); }
  catch { return "unreadable"; }
}

/** Is this checklist entry read RIGHT NOW — struck, and unchanged since? */
function effectivelyStruck(projectDir: string, struck: Map<string, string | null>, file: string): boolean {
  const hash = struck.get(file.toLowerCase());
  if (hash === undefined) return false;                  // never struck
  if (hash === null || hash === "unreadable") return true; // legacy / unhashable: counts
  return hash === contentHash(projectDir, file);         // edited since → back to unread (D12)
}

/** What is still unread: the checklist minus what is struck AND unchanged. */
export function readWorklist(projectDir: string): string[] {
  const struck = readStruck(projectDir);
  if (struck.size === 0) return readChecklist(projectDir);
  return readChecklist(projectDir).filter((f) => !effectivelyStruck(projectDir, struck, f));
}

/**
 * How many checklist entries are struck off and still unchanged (D12).
 *
 * Counted, never subtracted. "Everything minus what is still on the list" is
 * a different number the moment the list and the file tree disagree, and it
 * lies in the one direction that matters: it reports unread files as read.
 */
export function worklistDone(projectDir: string): number {
  const struck = readStruck(projectDir);
  if (struck.size === 0) return 0;
  return readChecklist(projectDir).filter((f) => effectivelyStruck(projectDir, struck, f)).length;
}

/**
 * Bring the checklist back in line with the files that exist right now (D29):
 * add what appeared since it was built, drop what vanished. Returns both sets
 * so the caller can say out loud that the scan is no longer complete.
 *
 * The struck-off record is deliberately left untouched — unlike
 * `writeWorklist`, which clears it. A reconcile must never un-strike a file
 * somebody genuinely read, and a file that vanished and came back is caught
 * by its content hash, not by wiping the ledger.
 */
export function reconcileWorklist(
  projectDir: string, all: string[],
): { added: string[]; removed: string[] } {
  const checklist = readChecklist(projectDir);
  const known = new Set(checklist.map((f) => f.toLowerCase()));
  const live = new Set(all.map((f) => f.toLowerCase()));
  const added = all.filter((f) => !known.has(f.toLowerCase()));
  const removed = checklist.filter((f) => !live.has(f.toLowerCase()));
  if (added.length === 0 && removed.length === 0) return { added, removed };
  mkdirSync(dirname(worklistFile(projectDir)), { recursive: true });
  atomicWrite(worklistFile(projectDir), all.join("\n") + (all.length > 0 ? "\n" : ""));
  return { added, removed };
}

export function writeWorklist(projectDir: string, files: string[]): void {
  mkdirSync(dirname(worklistFile(projectDir)), { recursive: true });
  atomicWrite(worklistFile(projectDir), files.join("\n") + (files.length > 0 ? "\n" : ""));
  // A fresh checklist beside a stale struck-off list would report every file as
  // already read — R7 switched off, silently. The two always move together.
  atomicWrite(doneFile(projectDir), "");
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
  // "Already crossed off" now means struck AND unchanged — an edited file is
  // back on the list, and re-reading it appends a fresh fingerprinted record.
  if (effectivelyStruck(projectDir, struck, target)) return -1;

  // One append, one write call, one line. The OS places it at the current end
  // of the file, so N concurrent processes produce N intact records — no lock,
  // no retry, no read-modify-write. (Local disks only: append atomicity does
  // not hold on network shares. A line here is a path plus a hash, still far
  // under a sector.)
  appendFileSync(doneFile(projectDir), `${target}\t${contentHash(projectDir, target)}\n`);
  // Count from a fresh read, taken after our own append: the set we loaded a
  // moment ago cannot see what other processes struck in between, and two
  // processes reporting the same remaining number is the symptom this idea
  // exists to remove. This read is for the number only — nothing is written
  // back, so it cannot lose anybody's record the way the old filter-and-rewrite did.
  const after = readStruck(projectDir);
  return checklist.filter((f) => !effectivelyStruck(projectDir, after, f)).length;
}

// ─── check ──────────────────────────────────────────────────────────────────

export interface CheckResult { errors: string[]; warnings: string[] }

const PLANNING_FIELDS = ["what", "why", "expected", "how", "why_this_way", "future"] as const;

/**
 * D31: every planned path is a project-relative POSIX path. An absolute path or
 * a `..` segment names a file the project does not own — the write gate refuses
 * it anyway (it compares project-relative paths), so all such a path can do is
 * sit in the graph as a lie nobody catches, and /ccfix reads the graph as fact.
 * Returns the complaint, or null when the path is fine.
 */
function badPlanPath(path: string): string | null {
  const posix = String(path).replaceAll("\\", "/");
  // `/x`, `//server/share/x` and `C:/x` are all "somewhere else on this machine".
  if (/^\//.test(posix) || /^[A-Za-z]:/.test(posix)) return "必须写成项目相对路径，不能是绝对路径";
  if (posix.split("/").includes("..")) return "不能含 `..`（父目录）段 —— 那指向项目之外";
  return null;
}

/** How many lines this file has right now. A trailing newline ends the last
 *  line, it does not start an empty one. */
function lineCount(text: string): number {
  if (text.length === 0) return 0;
  return text.replace(/\r?\n$/, "").split("\n").length;
}

/**
 * D32: a done idea's `lines` must be a readable `start-end`, 1-based, end not
 * before start, and it should still fit the file as it stands right now. Those
 * are two different faults and they do not deserve the same severity:
 *
 *   `impossible` — no edit to any file can turn a once-true `12-40` into `3-2`,
 *     `0-1` or `大概第三行`. A range shaped like that never described anything;
 *     it was already false at the moment somebody called the idea done, so it
 *     is a lie about the work being claimed, and stays an error.
 *   `stale` — the range parses and once fit; the file has since been shortened
 *     by other, permitted work. That is documentation drift on finished work,
 *     not an invalid graph, and R5 turns every check error into "you may not
 *     end the session" — grading drift as an error would let any ordinary
 *     shortening edit hold the session hostage to an unrelated done idea.
 *
 * Returns the complaint and its severity, or null. Only asked once the file is
 * known to exist — a missing file is already its own error.
 */
/** `lines` is a comma-separated list of SEGMENTS, each `start-end` or a bare
 *  single line. One idea's code legitimately lives in several disjoint hunks —
 *  the live ledger carries `731-742,1058-1207` for a change split across two
 *  functions, and `591,740` for a two-line touch. Reading it as one range was
 *  too narrow: it refused six real records and blocked the migration outright.
 *  Every segment is checked, and `impossible` outranks `stale` — a range no
 *  edit could ever have produced is a typo to fix now, while one the file has
 *  merely outgrown is drift on finished work (D32). */
function badLineRange(fullPath: string, lines: string): { kind: "impossible" | "stale"; why: string } | null {
  const impossible = (why: string) => ({ kind: "impossible" as const, why });
  const shape = `行号要写成 start-end（如 12-40），单行写行号，多段用逗号隔开（如 12-40,88），现在是「${lines}」`;
  // Empty segments are NOT filtered away: a trailing comma is what a truncated
  // record looks like («1-2,105» cut short), and silently reading it as «1-2»
  // would bless the truncation. An empty `lines` lands here too.
  const segments = String(lines).trim().split(",").map((s) => s.trim());
  if (segments.length === 0) return impossible(shape);

  let count: number | null;
  try { count = lineCount(readFileSync(fullPath, "utf8")); }
  catch { count = null; }   // 读不出来就不猜行数；文件存在与否另有一条错误管
  let stale: { kind: "stale"; why: string } | null = null;

  for (const segment of segments) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(segment);
    if (!m) return impossible(shape);
    const start = Number(m[1]);
    const end = m[2] === undefined ? start : Number(m[2]);
    if (start < 1) return impossible(`行号从 1 起算，start 不能是 ${start}`);
    if (end < start) return impossible(`end ${end} 小于 start ${start}`);
    if (count !== null && end > count && !stale) {
      stale = { kind: "stale", why: `end ${end} 超过文件现在只有的 ${count} 行` };
    }
  }
  return stale;
}

// `file` is the graph this came from, when the caller knows it. Omitted means
// the project's own graph — that is what the guard, `apply` and migrate check.
export function check(g: Graph, projectDir: string, file?: string): CheckResult {
  // H15: the canonical name can be occupied by a retired implementation's graph
  // (D10). Validating that against this engine's rules buries the real problem
  // under a pile of unrelated errors, so say the one thing that is wrong and
  // the one step that fixes it. A legacy graph a caller names explicitly is a
  // migration input and is still checked as itself — see the `--file` rule.
  const stamp = legacyStamp(g);
  if (stamp && (file === undefined || sameFile(file, graphPath(projectDir)))) {
    return { errors: [legacyAtCanonical(stamp)], warnings: [] };
  }

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

    // D8: an idea being built on a whole-project command with no `test_files`
    // has nothing that can go red on its own, so its implementation gate only
    // opens on a human red-waiver. A warning, not an error — the shape is legal
    // — said now, while adding a test file is still cheap, rather than at the
    // first blocked write.
    if (status === "doing" && idea.verify?.command && !(idea.verify.test_files ?? []).length) {
      warnings.push(`${at}: 在做，但 \`verify\` 只有一条命令、没有 \`test_files\` —— 没有能单独失败的测试就撑不起 RED，实现前要么补上测试文件，要么请人批一次 red-waiver（D8）`);
    }

    for (const ref of idea.code ?? []) {
      if (!ref.file) { errors.push(`${at}: a \`code\` entry has no file`); continue; }
      // D31: checked at every status. A path that leaves the project is wrong
      // the moment it is planned, not the moment somebody tries to write it.
      const strayed = badPlanPath(ref.file);
      if (strayed) { errors.push(`${at}: \`code\` 路径 ${ref.file} ${strayed}（D31）`); continue; }
      // Before it is built, `code.file` is a plan — the file is not supposed to
      // exist yet. Once done it must: question 6 is only worth anything if the
      // path resolves, and /ccfix trusts it.
      const full = resolve(projectDir, ref.file);
      if (status === "done" && !existsSync(full)) {
        errors.push(`${at}: code file not found — ${ref.file}`);
        continue;
      }
      // D32: same reasoning one level down — a done idea's line range is read
      // as fact. A range no file edit could ever produce is an error; a range
      // the file has simply outgrown is drift, and drift must not reach R5.
      if (status === "done" && ref.lines !== undefined) {
        const bad = badLineRange(full, ref.lines);
        if (bad?.kind === "impossible") {
          errors.push(`${at}: \`code\` ${ref.file} 的行号对不上：${bad.why}（D32）`);
        } else if (bad) {
          warnings.push(`${at}: \`code\` ${ref.file} 的行号过期了：${bad.why} —— 别处的改动把它改短了，记录该刷新：在 ideas/graph.yaml 里把这条 \`lines\` 改成现在的范围，再跑 \`${ENGINE_CMD} check\` 复核（D32）`);
        }
      }
    }

    // D31 again, for the other half of the plan: test paths are declared, never
    // guessed out of the command string, so they get the same boundary check.
    for (const rel of idea.verify?.test_files ?? []) {
      const strayed = badPlanPath(rel);
      if (strayed) errors.push(`${at}: \`verify.test_files\` 路径 ${rel} ${strayed}（D31）`);
    }
  }

  // The tree (FORMAT.md, "The tree"): `parent` is containment, not order.
  // A dangling parent or a parent cycle breaks the page — errors. Too many at
  // one level is only unreadable — warnings. Nothing nags a flat graph.
  const parentOf = new Map(g.ideas.map((i) => [i.id, String(i.parent ?? "").trim()]));
  const childCount = new Map<string, number>();
  const inReportedCycle = new Set<string>();
  let roots = 0;
  for (const idea of g.ideas) {
    const at = idea.id || "(missing id)";
    const parent = parentOf.get(idea.id) ?? "";
    if (!parent) { roots += 1; continue; }
    if (!parentOf.has(parent)) { errors.push(`${at}: parent「${parent}」不是图里的想法`); continue; }
    childCount.set(parent, (childCount.get(parent) ?? 0) + 1);
    if (inReportedCycle.has(idea.id)) continue;         // one report per cycle, like findCycle
    const path = [idea.id];
    for (let up = parent; up && parentOf.has(up); up = parentOf.get(up) ?? "") {
      path.push(up);
      if (up === idea.id) {
        errors.push(`parent 成环：${path.join(" → ")} —— 一个想法不能是自己的祖先`);
        for (const id of path) inReportedCycle.add(id);
        break;
      }
      if (path.length > g.ideas.length) break;   // a cycle that does not pass through us — reported from inside it
    }
  }
  if (roots > 7) warnings.push(`顶层有 ${roots} 个想法 —— 最多七个，人一眼扫不完；同类的归到一个父想法下`);
  for (const [pid, n] of childCount) {
    if (n > 7) warnings.push(`${pid}: 直接子想法 ${n} 个 —— 最多七个，再分一层`);
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
    warnings.push(`扫描未完成：还有 ${unread.length} 个文件没被读过（\`${ENGINE_CMD} scan\`）`);
  }

  return { errors, warnings };
}

// ─── readiness (I-089, absorbed from the Cursor implementation) ─────────────
// D17: whether an idea may enter `doing` is machine-decidable — plan fields
// answered, prerequisites done, no file overlap. These three are also what the
// guard's write policy (I-093) reuses, so "the engine says go" and "the guard
// says write" can never disagree.

/** The plan questions that must be answered before work starts (D17). */
const PLAN_FIELDS = ["what", "why", "expected", "how", "why_this_way", "future"] as const;

/** Null when ready to build; otherwise exactly what is missing. */
export function isBuildReady(idea: Idea): string | null {
  for (const field of PLAN_FIELDS) {
    if (!String(idea[field] ?? "").trim()) return `missing ${field}`;
  }
  if (!(idea.code ?? []).some((c) => c.file)) return "missing code.file (where the implementation will live)";
  if (!idea.verify?.command && !idea.verify?.manual) return "missing verify";
  return null;
}

/** Null when every prerequisite is done; otherwise the ones that are not. */
export function needsUnmet(idea: Idea, graph: Graph): string | null {
  const map = byId(graph);
  const unmet = (idea.needs ?? []).filter((n) => (map.get(n)?.status ?? "todo") !== "done");
  return unmet.length ? `waiting on ${unmet.join(", ")}` : null;
}

/**
 * Where an idea is filed. A `parent` naming an idea the graph does not have is
 * top level — the same rule the page draws by, so an idea never belongs to one
 * owner in the browser and a different one at the gate. `check` reports the
 * dangling id on its own; losing the idea would be the worse failure.
 *
 * The one copy of that rule: `render` reads it too, and the gate below is only
 * equivalent to what a reader sees because both call this.
 */
const filedUnder = (map: Map<string, Idea>, idea: Idea): string =>
  idea.parent && map.has(idea.parent) ? idea.parent : "";

/** The ideas filed directly under `id`, in graph order. */
export const childrenOf = (graph: Graph, id: string): Idea[] => {
  const map = byId(graph);
  return graph.ideas.filter((i) => filedUnder(map, i) === id);
};

/**
 * Null when every DIRECT child is done; otherwise the ones that are not (I-135).
 *
 * Direct children only, deliberately: every level enforces this for itself, so
 * the whole subtree is covered anyway, and the refusal gets to name something
 * the reader can see on the page in front of them instead of a grandchild three
 * clicks down. The two are equivalent only because `setStatus` is the one place
 * that writes a status — if a second writer ever appears, this has to grow.
 *
 * "not done" rather than "is todo": a blocked child is this format's own record
 * of an abandoned idea (keep the id, set blocked, write why). That is a record
 * of work that did NOT happen, so it blocks its parent exactly as hard. The
 * cost is real and was accepted when the rule was: an abandoned child holds its
 * parent open until somebody removes it from the graph.
 */
export function childrenUnfinished(idea: Idea, graph: Graph): string | null {
  const open = childrenOf(graph, idea.id).filter((c) => (c.status ?? "todo") !== "done");
  return open.length ? `子想法还没完成：${open.map((c) => c.id).join(", ")}` : null;
}

/** Every file an idea claims to write: its code files plus its test files. */
const claimedFiles = (idea: Idea): string[] => [
  ...(idea.code ?? []).map((c) => c.file).filter(Boolean),
  ...(idea.verify?.test_files ?? []),
];

/** Case-insensitive on Windows; slashes never matter. */
const sameFile = (a: string, b: string) => {
  const norm = (p: string) => p.replaceAll("\\", "/").replace(/\/+$/, "");
  return platform === "win32" ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
};

/** Null, or the OTHER doing idea already holding one of this idea's files (D18). */
export function fileClash(idea: Idea, graph: Graph): string | null {
  const mine = claimedFiles(idea);
  for (const other of graph.ideas) {
    if (other.id === idea.id || other.status !== "doing") continue;
    const shared = claimedFiles(other).filter((f) => mine.some((m) => sameFile(m, f)));
    if (shared.length) return `overlapping doing files — ${other.id}: ${shared.join(", ")}`;
  }
  return null;
}

/**
 * The write-ahead question `allow <path>` answers: could this file be written
 * right now? The ledger is always writable; a product file needs a build-ready
 * `doing` idea claiming it. The guard's strict rules (I-093) build on this.
 */
export function allowWrite(graph: Graph, projectDir: string, filePath: string): { allow: boolean; reason: string } {
  const root = resolve(projectDir).replaceAll("\\", "/");
  const rel = resolve(projectDir, filePath).replaceAll("\\", "/")
    .replace(new RegExp(`^${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`, platform === "win32" ? "i" : ""), "");
  if (/^ideas\//i.test(rel)) return { allow: true, reason: "账本文件随时可写" };

  const doing = graph.ideas.filter((i) => i.status === "doing");
  for (const idea of doing) {
    if (isBuildReady(idea)) continue;   // doing but not ready unlocks nothing
    if (claimedFiles(idea).some((f) => sameFile(f, rel))) {
      return { allow: true, reason: `${idea.id} 认领了它` };
    }
  }
  return {
    allow: false,
    reason: doing.length === 0
      ? `没有任何想法在进行中 — 先 set <id> doing`
      : `没有进行中的想法认领 ${rel}`,
  };
}

// ─── new ────────────────────────────────────────────────────────────────────

/** Top-level next_id, placed with the other header keys — never after ideas. */
function writeNextId(doc: Document, value: number): void {
  const top = doc.contents as { items?: { key?: { value?: string } }[] };
  const had = (top.items ?? []).some((p) => p.key?.value === "next_id");
  doc.setIn(["next_id"], value);
  // setIn appends a brand-new key at the very end — several hundred lines
  // below the ideas list, where nobody reading the file would look for it.
  if (!had && top.items) {
    const added = top.items.pop()!;
    const at = top.items.findIndex((p) => p.key?.value === "ideas");
    top.items.splice(at < 0 ? top.items.length : at, 0, added);
  }
}

/**
 * Create an idea. The id comes from `next_id` — take the number, then add one
 * (D28). Never "highest + 1" from the current graph: a deleted highest number
 * would be handed out again, and two parallel editors would mint the same id.
 */
export function addIdea(doc: Document, graph: Graph, name: string, needs: string[], date: string): string {
  for (const n of needs) {
    if (!graph.ideas.some((i) => i.id === n)) throw new Error(`未知前置 ${n}`);
  }
  const highest = graph.ideas.reduce((m, i) => Math.max(m, idNumber(i.id) || 0), 0);
  const n = Number(graph.next_id) || highest + 1;   // the counter's initial value is a rule
  const id = formatId(n);
  doc.setIn(["ideas", graph.ideas.length], {
    id, name, status: "todo",
    ...(needs.length ? { needs } : {}),
    log: [{ date, by: "new", note: "创建" }],
  });
  writeNextId(doc, n + 1);
  return id;
}

// ─── approval (I-090, absorbed from the Codex implementation) ───────────────
// D7/D26/D27: an approval is a content-bound review receipt. The agent asks;
// the program mints a one-time challenge bound to a digest of exactly what the
// human is being asked to review; only a real human reply whose WHOLE message
// is `批准 CC-XXXXXXXX` (or APPROVE/拒绝/REJECT) consumes it. Change one word
// of the reviewed content and the challenge self-destructs. Receipts live in
// ideas/.runtime/approvals/ and are re-verified against the current graph on
// every use — never cached. Honest boundary (D26): this is a behavioural
// guardrail, not cryptography; hook trust, git and CI carry the real security.

export type Gate = "plan" | "red-waiver" | "manual-check";

const sha256 = (text: string) =>
  createHash("sha256").update(text.replaceAll("\r\n", "\n")).digest("hex");

/** One projected idea: exactly what the human is asked to approve, and exactly
 *  what the digest covers — this idea's own review content and nothing else.
 *  `code` stops at file+symbol and `verify` leaves out `signed_off`: line
 *  numbers are written back by ccbuild after implementing and the signature by
 *  the manual-check reply, so neither is something a reviewer approves, and
 *  putting them in the digest made every finished implementation void its own
 *  approval. Status, log and every other idea are outside it on purpose (D7). */
export interface ApprovalEntry {
  id: string; name: string; parent: string; needs: string[];
  what: string; why: string; expected: string;
  how: string; why_this_way: string; future: string;
  code: { file: string; symbol: string }[];
  verify: { command: string; test_files: string[]; pass: string; manual: string };
}

/**
 * The content a human is asked to approve, one entry per named idea. Handing
 * the projection out (rather than hashing a local and throwing it away) means
 * the printed text and the hashed text are one value, not two paths that
 * drift (I-102).
 *
 * **The object literal below is load-bearing byte for byte.** The digest is
 * `sha256(JSON.stringify(...))`, so key ORDER is part of it: tidying the field
 * order here silently voids every receipt on disk — this repo's and those of
 * every repo that installed the base.
 */
export function approvalProjection(graph: Graph, nodeIds: string[]): ApprovalEntry[] {
  const map = byId(graph);
  return nodeIds.map((id) => {
    const i = map.get(id);
    if (!i) throw new Error(`no idea with id ${id}`);
    const v = i.verify ?? {};
    return {
      id: i.id, name: i.name, parent: i.parent ?? "", needs: i.needs ?? [],
      what: i.what ?? "", why: i.why ?? "", expected: i.expected ?? "",
      how: i.how ?? "", why_this_way: i.why_this_way ?? "", future: i.future ?? "",
      code: (i.code ?? []).map((c) => ({ file: c.file, symbol: c.symbol ?? "" })),
      verify: { command: v.command ?? "", test_files: v.test_files ?? [], pass: v.pass ?? "", manual: v.manual ?? "" },
    };
  });
}

/** The twelve-hex digest of ONE idea's review content. Each idea stands alone:
 *  a receipt for I-101 says nothing about I-102, and editing I-102 cannot
 *  touch I-101's approval (D7). */
export function approvalSnapshot(graph: Graph, nodeId: string): string {
  return sha256(JSON.stringify(approvalProjection(graph, [nodeId])[0])).slice(0, 12);
}

/**
 * The projection as text for a person to read before answering a challenge.
 * It takes the PROJECTION, never the graph — so it cannot print a field the
 * digest does not cover, and the guarantee is a type rather than a discipline.
 * That matters: the cheap wrong implementation here is to re-run `show`, which
 * would add status, resolved prerequisites and the log — three things nobody
 * hashed, printed as if they were part of what was approved (I-102).
 */
export function approvalLines(entries: ApprovalEntry[]): string[] {
  const out: string[] = [];
  for (const e of entries) {
    out.push(`${e.id}  ${e.name}`);
    out.push(`父想法  ${e.parent || "—（顶层）"}`);
    out.push(`前置想法  ${e.needs.length ? e.needs.join(", ") : "—"}`);
    for (const block of questionLines(e)) out.push(`\n${block}`);
    out.push("");
  }
  return out;
}

const pendingDir = (projectDir: string) => join(paths(projectDir).approvals, "pending");
const approvalsDir = (projectDir: string) => join(paths(projectDir).approvals, "receipts");
// Where both lived before I-138 (machine-local, git-ignored). Read, never
// written: a receipt already on disk keeps counting, a challenge already
// minted stays answerable, and nothing is migrated.
const legacyPendingDir = (projectDir: string) => join(paths(projectDir).runtime, "pending");
const legacyApprovalsDir = (projectDir: string) => join(paths(projectDir).runtime, "approvals");

export interface Challenge { challenge: string; gate: Gate; file: string }

/** One challenge may name several ideas — one reply, one receipt, but a digest
 *  PER idea inside it, so each idea's approval lives and dies on its own
 *  content. The receipt is `{ v: 2, snapshots: { "I-101": "…", … } }`; the v1
 *  shape (`node_ids` + one `snapshot`) is no longer read anywhere. */
export function requestApproval(
  projectDir: string, graph: Graph, gate: Gate, nodeIds: string[],
  meta: { by?: string; date?: string } = {},
): Challenge {
  if (!nodeIds.length) throw new Error(`${gate} 关卡必须点名想法（nodeIds）`);
  if (gate === "manual-check") {
    for (const id of nodeIds) {
      const idea = byId(graph).get(id);
      if (!idea?.verify?.manual) throw new Error(`${id} 的验证不是人工检查（manual）——manual-check 关卡只签人工验收`);
      if (idea.verify.signed_off) throw new Error(`${id} 已经有人签过字了，不能覆盖`);
      // I-135: signing is how a manual-check idea is closed, so the completion
      // gate stands here as well as on `set done`. Without it the parent gets a
      // valid signature while everything under it is still open.
      const openKids = childrenUnfinished(idea, graph);
      if (openKids) throw new Error(`${id} 还不能提签字请求 —— ${openKids}`);
    }
  }
  const snapshots = Object.fromEntries(nodeIds.map((id) => [id, approvalSnapshot(graph, id)]));
  const challenge = `CC-${randomBytes(4).toString("hex").toUpperCase()}`;
  const file = join(pendingDir(projectDir), `${challenge}.json`);
  mkdirSync(pendingDir(projectDir), { recursive: true });
  atomicWrite(file, JSON.stringify({
    v: 2, challenge, gate, snapshots,
    requested_at: meta.date ?? "", by: meta.by ?? "",
  }, null, 2));
  return { challenge, gate, file };
}

export interface ApprovalOutcome { ok: boolean; decision?: "approved" | "rejected"; gate?: Gate; reason?: string }

// The whole (trimmed) message must BE the answer — prose around the token is a
// conversation, not a consent. Mirrors the graph-level "批准" rule.
const ANSWER = /^\s*(批准|同意|APPROVE|拒绝|REJECT)\s+(CC-[A-Fa-f0-9]{8})\s*[。.!！]?\s*$/;

/**
 * Called from the UserPromptSubmit path with the human's literal message.
 * Returns null when the message is not a challenge answer at all.
 */
export function applyApproval(
  projectDir: string, prompt: string,
  meta: { date: string; session_id?: string; turn_id?: string },
): ApprovalOutcome | null {
  const m = ANSWER.exec(prompt ?? "");
  if (!m) return null;
  const decision = /^(批准|同意|APPROVE)$/i.test(m[1]) ? "approved" as const : "rejected" as const;
  const challenge = m[2].toUpperCase();
  const file = [pendingDir(projectDir), legacyPendingDir(projectDir)]
    .map((d) => join(d, `${challenge}.json`)).find((f) => existsSync(f));
  if (!file) return { ok: false, reason: `口令 ${challenge} 不存在或已用过 —— 重新 request-approval` };

  const pending = JSON.parse(readFileSync(file, "utf8")) as
    { gate: Gate; snapshots?: Record<string, string>; by?: string };
  const { graph } = load(graphPath(projectDir));
  const ids = Object.keys(pending.snapshots ?? {});
  const drifted = ids.some((id) => {
    let current: string;
    try { current = approvalSnapshot(graph, id); } catch { current = "<node-gone>"; }
    return current !== pending.snapshots![id];
  });
  if (ids.length === 0 || drifted) {
    rmFileQuietly(file);   // self-destruct on drift: a stale challenge must not linger answerable
    return { ok: false, reason: "被批的内容在请求之后被改过了，口令作废 —— 重新 request-approval" };
  }

  // I-135: the challenge was minted when the children were done; by the time the
  // person answers they may not be. A child's status is not part of the parent's
  // content digest, so the drift check above cannot see this — and THIS is the
  // door that actually writes `signed_off`, the only one in the file. The
  // challenge is destroyed rather than left lying around: a token that becomes
  // answerable again when the world changes, with nobody re-reading what they
  // are signing, is the thing one-time challenges exist to prevent.
  if (decision === "approved" && pending.gate === "manual-check") {
    for (const id of ids) {
      const idea = byId(graph).get(id);
      const openKids = idea && childrenUnfinished(idea, graph);
      if (openKids) {
        rmFileQuietly(file);
        return {
          ok: false,
          reason: `${id} 签不上 —— ${openKids}。等子想法完成后重新 request-approval --gate manual-check --node ${id}`,
        };
      }
    }
  }

  mkdirSync(approvalsDir(projectDir), { recursive: true });
  atomicWrite(join(approvalsDir(projectDir), `${challenge}.json`), JSON.stringify({
    ...pending, decision, responded_at: meta.date,
    session_id: meta.session_id ?? "", turn_id: meta.turn_id ?? "",
    prompt_sha256: sha256(prompt),
  }, null, 2));
  rmFileQuietly(file);

  // D27: a manual check is signed only through this path — the CLI writes the
  // signature digest back into the graph, traceable to the one-time reply.
  if (decision === "approved" && pending.gate === "manual-check") {
    const { doc, graph: g } = load(graphPath(projectDir));
    for (const id of ids) {
      const index = g.ideas.findIndex((i) => i.id === id);
      if (index < 0) continue;
      doc.setIn(["ideas", index, "verify", "signed_off"],
        `${pending.by || "人"} ${meta.date} —— 经一次性口令 ${challenge} 批准；回执 ideas/approvals/receipts/${challenge}.json`);
    }
    save(graphPath(projectDir), doc);
  }
  return { ok: true, decision, gate: pending.gate };
}

function rmFileQuietly(file: string): void {
  try { unlinkSync(file); } catch { /* already gone is fine */ }
}

/** Is there a receipt for exactly this idea's current content? Re-derived on
 *  every call, never cached, and never expired by time or session: the only
 *  thing that retires an approval is a change to what was approved (D7). */
export function validApproval(projectDir: string, graph: Graph, gate: Gate, nodeId: string): boolean {
  let want: string;
  try { want = approvalSnapshot(graph, nodeId); } catch { return false; }
  for (const dirPath of [approvalsDir(projectDir), legacyApprovalsDir(projectDir)]) {
    if (!existsSync(dirPath)) continue;
    for (const name of readdirSync(dirPath)) {
      try {
        const r = JSON.parse(readFileSync(join(dirPath, name), "utf8"));
        if (r.decision === "approved" && r.gate === gate && r.snapshots?.[nodeId] === want) return true;
      } catch { /* an unreadable receipt proves nothing */ }
    }
  }
  return false;
}

// ─── evidence (I-091, absorbed from the Codex implementation) ───────────────
// D8/D20: test-first is evidence, not etiquette. Before implementation there
// must be a recorded RED — the verify command really ran and really failed;
// `done` needs a GREEN that is still current: no implementation write since it
// ran, and the test files' fingerprints unchanged. A test that passes before
// it should (unexpected_pass) blocks until a human grants a red-waiver through
// the I-090 challenge chain. Staleness is a monotonic per-idea change counter,
// not a timestamp — clocks skew and rewind, a counter bumped by the write hook
// does neither.

interface CheckRun {
  exit_code: number; output_tail: string; test_hashes: Record<string, string>; at_seq: number;
  outcome?: "red" | "unexpected_pass" | "infra_error";
  // Only on an infra_error run; older evidence files simply lack it (H5).
  infra_error?: string;
}
interface Evidence { change_seq?: number; red?: CheckRun; green?: CheckRun }

const evidenceFile = (projectDir: string, id: string) => join(paths(projectDir).runtime, `${id}.json`);

function readEvidence(projectDir: string, id: string): Evidence {
  const file = evidenceFile(projectDir, id);
  if (!existsSync(file)) return {};
  try { return JSON.parse(readFileSync(file, "utf8")) as Evidence; } catch { return {}; }
}

function writeEvidence(projectDir: string, id: string, evidence: Evidence): void {
  mkdirSync(paths(projectDir).runtime, { recursive: true });
  atomicWrite(evidenceFile(projectDir, id), JSON.stringify(evidence, null, 2));
}

/** Fingerprints of the idea's declared test files, as they are right now. */
function hashTests(projectDir: string, idea: Idea): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of idea.verify?.test_files ?? []) {
    const full = join(resolve(projectDir), rel);
    out[rel] = existsSync(full) ? sha256(readFileSync(full, "utf8")) : "missing";
  }
  return out;
}

/** The declared test files that really exist right now (H5). */
function presentTests(projectDir: string, idea: Idea): string[] {
  return (idea.verify?.test_files ?? []).filter((rel) => existsSync(join(resolve(projectDir), rel)));
}

const sameHashes = (a: Record<string, string>, b: Record<string, string>) =>
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

// D8: a command that never really ran is not a failing test. A missing
// executable, a timeout, a signal and a spawn error all leave a non-zero (or
// no) exit code, so without this classification one typo in verify.command
// counts as RED and opens the implementation gate. The shell says "not found"
// with 127 (POSIX sh) or 9009 (cmd.exe); Windows may run either as ComSpec.
const NOT_FOUND_EXITS = platform === "win32" ? [9009, 127] : [127];

// cmd.exe answers "is not recognized" with a plain exit 1, so on Windows the
// exit code alone cannot tell a typo from a failing test. Resolve the program
// the shell would run before running it, the way the retired Python
// implementation did; compound command lines are left to the codes above.
const SHELL_OPERATORS = /[|&;<>`$(){}\n]/;

/** The declared command's program, if it plainly is not runnable (H5). */
function missingExecutable(projectDir: string, command: string): string | undefined {
  if (SHELL_OPERATORS.test(command)) return undefined;   // 复合命令，读不出到底跑的是谁
  const token = (command.trim().match(/^"([^"]+)"|^'([^']+)'|^(\S+)/) ?? []).slice(1).find(Boolean);
  if (!token) return undefined;
  if (/[\\/]/.test(token)) {
    return existsSync(resolve(projectDir, token)) ? undefined : `找不到可执行文件 ${token}`;
  }
  const exts = platform === "win32" ? ["", ...(env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")] : [""];
  for (const dir of (env.PATH ?? "").split(platform === "win32" ? ";" : ":")) {
    if (!dir) continue;
    for (const ext of exts) if (ext !== undefined && existsSync(join(dir, token + ext))) return undefined;
  }
  return `命令没找到：${token} 不在 PATH 上`;
}

/** Why this run proves nothing — undefined when the command really ran (H5). */
function infraReason(run: SpawnSyncReturns<string>): string | undefined {
  const error = run.error as NodeJS.ErrnoException | undefined;
  if (error) {
    return error.code === "ETIMEDOUT"
      ? "命令超时，被强行杀掉"
      : `命令没能启动：${error.message}`;
  }
  if (run.signal) return `命令被信号 ${run.signal} 杀掉`;
  if (run.status === null) return "命令没有留下退出码（超时或被杀）";
  if (NOT_FOUND_EXITS.includes(run.status)) return `命令没找到（退出码 ${run.status}）`;
  return undefined;
}

/**
 * The same verdict re-derived from a stored record, so evidence written before
 * H5 (no `infra_error` field) is judged by its exit code too.
 */
function infraOf(run: CheckRun): string | undefined {
  if (run.outcome === "infra_error") return run.infra_error ?? "命令没能真正跑起来";
  if (run.exit_code === -1) return "命令没有留下退出码（超时或被杀）";
  if (NOT_FOUND_EXITS.includes(run.exit_code)) return `命令没找到（退出码 ${run.exit_code}）`;
  return undefined;
}

/**
 * The write hook calls this after every implementation write: every idea whose
 * `code` claims the file gets its change counter bumped, which is what makes
 * an old GREEN visibly stale. Test-file writes do not bump — their drift is
 * caught by fingerprint comparison instead.
 */
export function recordChange(projectDir: string, graph: Graph, filePath: string): void {
  const root = resolve(projectDir).replaceAll("\\", "/");
  const rel = resolve(projectDir, filePath).replaceAll("\\", "/")
    .replace(new RegExp(`^${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`, platform === "win32" ? "i" : ""), "");
  for (const idea of graph.ideas) {
    if (!(idea.code ?? []).some((c) => c.file && sameFile(c.file, rel))) continue;
    const evidence = readEvidence(projectDir, idea.id);
    evidence.change_seq = (evidence.change_seq ?? 0) + 1;
    writeEvidence(projectDir, idea.id, evidence);
  }
}

export interface GateResult { ready: boolean; reason?: string }

/** May implementation be written? Only past a real, still-fresh RED. */
export function redGateReady(projectDir: string, graph: Graph, id: string): GateResult {
  const idea = byId(graph).get(id);
  if (!idea) return { ready: false, reason: `no idea with id ${id}` };
  if (!idea.verify?.command) return { ready: true, reason: "manual-only" };  // 人工验收的想法由签字把关
  const evidence = readEvidence(projectDir, id);
  if (!evidence.red) {
    return { ready: false, reason: `还没有 RED 记录 —— 先 run-check ${id} --phase red，看着测试真的失败` };
  }
  // D8: 命令坏了和测试红了是两回事，说清楚是哪一种（H5）。这一条站在豁免之上：
  // 人能批「这次失败算数」，批不了「一条根本没跑起来的命令算数」。
  const broken = infraOf(evidence.red);
  if (broken) {
    return { ready: false, reason: `上次 red 里验证命令根本没跑起来：${broken} —— 这是命令坏了，不是测试红了；修好 verify.command 再重跑 run-check ${id} --phase red` };
  }
  if (!sameHashes(evidence.red.test_hashes, hashTests(projectDir, idea))) {
    return { ready: false, reason: `RED 证据已过期（stale）—— 测试文件在失败记录之后被改过，重跑 red` };
  }
  // D8: 一个存在的测试文件都没有时，那条命令的非零退出可能来自任何地方，单靠
  // 它撑不起一次 RED（H5）。但「一条整项目命令、没有 test_files」本身是合法形
  // 状，硬拒会把这些想法永远锁死 —— 所以和 unexpected_pass 一样交给人裁决：
  // 这一条必须留在 red-waiver 分支之上够得着的位置。
  const declared = idea.verify.test_files ?? [];
  if (presentTests(projectDir, idea).length === 0) {
    if (validApproval(projectDir, graph, "red-waiver", id)) {
      return { ready: true, reason: "没有可失败的测试文件 + 人批的豁免" };
    }
    const gap = declared.length === 0
      ? `${id} 没有 verify.test_files`
      : `${id} 声明的测试文件一个都不存在（${declared.join("、")}）`;
    return {
      ready: false,
      reason: `${gap} —— 没有测试文件时，验证命令的非零退出可能来自任何地方，撑不起一次 RED（D8）。两条出路：把会失败的测试写出来、写进 verify.test_files 再 run-check ${id} --phase red，或者请人批一次豁免（request-approval --gate red-waiver --node ${id}）`,
    };
  }
  if (evidence.red.outcome === "unexpected_pass") {
    return validApproval(projectDir, graph, "red-waiver", id)
      ? { ready: true, reason: "unexpected_pass + 人批的豁免" }
      : { ready: false, reason: `测试意外先绿（unexpected_pass）—— 需要人批一次 red-waiver（request-approval --gate red-waiver --node ${id}）` };
  }
  return { ready: true };
}

/** Is the GREEN record valid for the idea as it stands right now? */
export function greenCurrent(projectDir: string, graph: Graph, id: string): boolean {
  const idea = byId(graph).get(id);
  if (!idea?.verify?.command) return false;
  const evidence = readEvidence(projectDir, id);
  if (!evidence.green || evidence.green.exit_code !== 0) return false;
  if (evidence.green.at_seq !== (evidence.change_seq ?? 0)) return false;      // 实现又动过了
  return sameHashes(evidence.green.test_hashes, hashTests(projectDir, idea));  // 测试也没被偷改
}

/**
 * The complete write verdict for one file (I-099) — the ONE function behind
 * both the `allow` command and the guard, so they can never disagree:
 * evidence files are CLI-only (D24), legacy suffixed graphs are read-only
 * migration inputs (D10), the ledger stays writable, and a product file needs
 * exactly one thing: a doing idea that names it in `code.file` or
 * `verify.test_files` (D16). 2026-09-16 (I-146): the plan-approval re-check
 * (D7) and the RED gate (D8) came off this door — what a hook can machine-check
 * against the eight answers is the paths of questions 6 and 7, nothing else.
 */
export function decideProductWrite(projectDir: string, graph: Graph, filePath: string): { allow: boolean; reason: string } {
  const root = resolve(projectDir).replaceAll("\\", "/");
  const full = resolve(projectDir, filePath).replaceAll("\\", "/");
  const inRoot = platform === "win32"
    ? full.toLowerCase().startsWith(root.toLowerCase() + "/")
    : full.startsWith(root + "/");
  const rel = inRoot ? full.slice(root.length + 1) : full;
  const p = paths(projectDir);

  for (const [file, label] of [
    [p.approved, "批准记录"], [p.worklist, "扫描清单"], [p.done, "已读记录"], [p.html, "生成的网页"],
  ] as [string, string][]) {
    if (sameFile(full, file.replaceAll("\\", "/"))) {
      return { allow: false, reason: `${label}只能由 CLI 和 hook 产生，谁都不许直接写（D24）。` };
    }
  }
  const relLower = platform === "win32" ? rel.toLowerCase() : rel;
  if (relLower === "ideas/.runtime" || relLower.startsWith("ideas/.runtime/")) {
    return { allow: false, reason: "ideas/.runtime/ 里是程序保管的证据（测试红绿记录、旧的批准回执），只能由 CLI 产生（D24）。要留证据：run-check / request-approval。" };
  }
  if (relLower === "ideas/approvals" || relLower.startsWith("ideas/approvals/")) {
    return { allow: false, reason: "ideas/approvals/ 里是一次性口令和批准回执，进 git 但只能由 CLI 和 hook 产生（D24，I-138）。要请批准：request-approval；回答只能由人在对话里回。" };
  }
  if (/^ideas\/graph\.[^/]+\.ya?ml$/i.test(rel)) {
    return { allow: false, reason: `${rel} 是迁移输入，迁移后只读（D10）—— 项目的图只有 ideas/graph.yaml 一份。要合并旧内容：migrate。` };
  }
  if (relLower === "ideas" || relLower.startsWith("ideas/")) {
    return { allow: true, reason: "账本文件可编辑（status/signed_off 的防手改由守卫按具体改动另判）" };
  }

  const doing = graph.ideas.filter((i) => i.status === "doing" && !isBuildReady(i));

  // 2026-09-16（I-146）：这道门只问认领。写时重查计划批准（D7）和 RED 门（D8）都拆了：
  // 三道闸叠在同一次写上，加一行文档的成本和改守卫核心一样贵，而批准改一个字就作废，
  // 人反复在重批同一个想法。守卫能机器判定的「写的东西和八问一致」只有第六、七问的
  // 路径；其余六问由代理写完对照、人看网页复核。RED→GREEN 仍是 done 的条件（D20），
  // 只是不再挡在实现之前。
  const testOwner = doing.find((i) => (i.verify?.test_files ?? []).some((f) => sameFile(f, rel)));
  if (testOwner) return { allow: true, reason: `${testOwner.id} 的测试文件（verify.test_files 点名）` };

  const codeOwner = doing.find((i) => (i.code ?? []).some((c) => c.file && sameFile(c.file, rel)));
  if (codeOwner) return { allow: true, reason: `${codeOwner.id} 认领了它（code.file 点名）` };

  return {
    allow: false,
    reason: doing.length === 0
      ? "没有任何想法在进行中，产品文件默认不可写（D16）—— 先 set <id> doing。"
      : `没有进行中的想法认领 ${rel}（D16）—— 路径缺口应该在计划里补（code.file / verify.test_files），不是在实现时当自由区。`,
  };
}

/**
 * A declared verify command is handed to a shell VERBATIM, so it has to BE one
 * command: separators, pipes, redirects, line breaks and both spellings of
 * command substitution each carry a second command the human never reviewed
 * (D21/D28). This is the SAME question the guard's shell rule asks before it
 * honours a declared verify command; it lives here, on the engine side, because
 * guard.ts imports ideas.ts and not the other way round — one predicate, both
 * doors, which is the drift D11 exists to prevent.
 */
export const isChainedCommand = (command: string) => /[;&|<>\r\n]|\$\(|`/.test(command);

/**
 * The chained-command screen WHOLE: the predicate above and the words the human
 * is shown, in one place, because both doors need both halves. The guard asks
 * it before it honours a declared `verify.command`; `run-check` asks it below
 * before it spawns one. Keeping a second regex plus a second wording on the
 * guard side is not "the same rule twice", it is two rules that happen to agree
 * today — which is how the three engines forked and exactly what D11 forbids.
 * Returns the refusal to show the human, or null when it really is one command.
 *
 * guard.ts still declares its own `CHAINED_COMMAND` and restates these words in
 * its declared-verify branch: that constant and that message should both become
 * a call to this function.
 */
export function chainedCommandRefusal(idea: Pick<Idea, "id" | "name">, command: string): string | null {
  if (!isChainedCommand(command)) return null;
  return `${idea.id}「${idea.name}」的 verify.command 里串了第二条命令（分号/与号/管道/重定向/换行/命令替换）——「${command.slice(0, 80)}」。`
    + `验证命令是被原样交给 shell 跑的，所以它只能是一条命令（D21/D28）：把图里这条改成单条命令，多步验证拆成多个想法或写进脚本再由人过目。`;
}

/**
 * The one condition the guard applies to a declared verify command, asked
 * again at the engine's own point of execution: it must BE one command
 * (D21/D28). `run-check` spawns `idea.verify.command` through a shell and sits
 * on the guard's engine allowlist, so the chain screen has to live here too.
 * 2026-09-16 (I-146): the plan-approval condition came off — a single command
 * an agent could equally type into Bash buys it nothing by being in the graph.
 * Returns the refusal to show the human, or null to proceed.
 */
function verifyCommandRefusal(_projectDir: string, _graph: Graph, idea: Idea, command: string): string | null {
  return chainedCommandRefusal(idea, command);
}

/**
 * Run the idea's verify command for real and record what happened. Either
 * phase runs on request; `done` still needs a current GREEN (D20).
 */
export function runCheck(
  projectDir: string, graph: Graph, id: string, phase: "red" | "green",
  opts: { timeoutMs?: number } = {},
): CheckRun {
  const idea = byId(graph).get(id);
  if (!idea) throw new Error(`no idea with id ${id}`);
  const command = idea.verify?.command;
  if (!command) throw new Error(`${id} 没有 verify.command —— 人工验收的想法用 manual-check 关卡`);
  // Asked before anything is spawned OR recorded: a refused run leaves the
  // existing evidence exactly as it was (D7/D21/D28).
  const refusal = verifyCommandRefusal(projectDir, graph, idea, command);
  if (refusal) throw new Error(refusal);
  // 2026-09-16（I-146）：green 不再等 red。红记录仍可留、仍会记，只是不挡路。

  const missing = missingExecutable(projectDir, command);
  const run = missing ? null : spawnSync(command, {
    shell: true, cwd: resolve(projectDir), encoding: "utf8",
    timeout: opts.timeoutMs ?? 120_000,
  });
  const evidence = readEvidence(projectDir, id);
  const broken = missing ?? infraReason(run!);
  const record: CheckRun = {
    exit_code: run?.status ?? -1,
    output_tail: `${run?.stdout ?? ""}${run?.stderr ?? ""}${broken ? `\n[companion] ${broken}` : ""}`.slice(-2000),
    test_hashes: hashTests(projectDir, idea),
    at_seq: evidence.change_seq ?? 0,
  };
  // Recorded honestly, but a run that never happened satisfies no gate (D8/H5).
  if (broken) {
    record.outcome = "infra_error";
    record.infra_error = broken;
  } else if (phase === "red") {
    record.outcome = record.exit_code === 0 ? "unexpected_pass" : "red";
  }
  if (phase === "red") evidence.red = record; else evidence.green = record;
  writeEvidence(projectDir, id, evidence);
  return record;
}

// ─── migrate (I-092) ────────────────────────────────────────────────────────
// D10: legacy graphs are read-only inputs; the project gets ONE plain
// ideas/graph.yaml, and only an explicit, human-answerable migration produces
// it. Multiple legacy graphs found → stop and make the human pick; never guess
// a winner. Anything that cannot convert losslessly goes into a written report
// instead of vanishing.

export interface MigrateResult { ok: boolean; written?: string; report?: string[]; reason?: string }

type LegacyKind = "claude" | "cursor" | "codex";
export interface LegacySource {
  kind: LegacyKind;
  path: string;
  /** Set only when this legacy graph sits at the canonical name (H15): the one
   *  sentence saying what it is and what the human has to do about it. */
  instruction?: string;
}

interface LegacyStamp { key: string; agent: string; kind: LegacyKind }

/**
 * The keys that give a retired implementation's graph away: `agent:` stamps it
 * as one agent's file (D10 — the graph belongs to the project), and `enforce:` /
 * `exempt:` are the in-graph switches D24/D25 removed. Returns the key that
 * gives it away plus who wrote it, or null for an ordinary project graph.
 */
function legacyStamp(graph: unknown): LegacyStamp | null {
  const g = graph as Record<string, unknown> | null;
  if (!g || typeof g !== "object") return null;
  const agent = typeof g.agent === "string" ? g.agent.trim().toLowerCase() : "";
  // enforce/exempt were the Cursor gate's own switches, so a graph carrying
  // them without an `agent:` key came from cursor-companion.
  const kind = (["claude", "cursor", "codex"] as const).find((k) => k === agent) ?? "cursor";
  if (agent) return { key: `agent: ${agent}`, agent, kind };
  const key = ["enforce", "exempt"].find((k) => g[k] !== undefined);
  return key ? { key: `${key}:`, agent: "cursor", kind } : null;
}

/** Same question, asked of a file. Unreadable or unparsable → not our problem here. */
function legacyStampOf(file: string): LegacyStamp | null {
  try { return legacyStamp(parseDocument(readFileSync(file, "utf8")).toJSON()); } catch { return null; }
}

/**
 * H15/D10: one sentence for the one situation — a legacy graph parked on the
 * canonical name. The rename is a human decision about a live file, so the
 * engine names the step and stops; it never moves the file itself.
 */
function legacyAtCanonical(stamp: LegacyStamp): string {
  return `ideas/graph.yaml 带着 ${stamp.key} —— 这是旧实现（${stamp.agent}）留下的图，不是本引擎的项目图（D10）：`
    + `请人先手工把它改名成 ideas/graph.${stamp.agent}.yaml，再跑 \`migrate\` 把内容并进来（引擎不替人改名，也不动这个文件）。`;
}

export function findLegacySources(projectDir: string): LegacySource[] {
  const out: LegacySource[] = [];
  // H15: the canonical name itself can be occupied by a legacy graph — the one
  // place the old search never looked, because it only knew suffixed names.
  const plain = graphPath(projectDir);
  if (existsSync(plain)) {
    const stamp = legacyStampOf(plain);
    if (stamp) out.push({ kind: stamp.kind, path: plain, instruction: legacyAtCanonical(stamp) });
  }
  for (const kind of ["claude", "cursor"] as const) {
    const p = join(IDEAS_DIR(projectDir), `graph.${kind}.yaml`);
    if (existsSync(p)) out.push({ kind, path: p });
  }
  for (const name of [".codex-companion", ".codex-companion.codex"]) {
    const p = join(resolve(projectDir), name, "nodes");
    if (existsSync(p)) { out.push({ kind: "codex", path: p }); break; }
  }
  return out;
}

/** D4: the eight Codex statuses fold into four. Every fold is reported. */
const CODEX_STATUS: Record<string, Status> = {
  draft: "todo", aligned: "todo", planned: "todo", approved: "todo",
  implementing: "doing", blocked: "blocked", done: "done", superseded: "blocked",
};

interface CodexNode {
  id: string; name?: string; status?: string; depends_on?: string[];
  what?: string; why?: string; expected_result?: string;
  implementation?: { how?: string; why_this_way?: string };
  code_refs?: { path: string; start_line?: number; end_line?: number; role?: string }[];
  verification?: { id?: string; kind?: string; plan?: string; command?: string | string[]; test_paths?: string[] }[];
  future_use?: string; created_at?: string;
}

function convertCodex(nodesDir: string, projectName: string, date: string): { text: string; graph: Graph; report: string[] } {
  const report: string[] = [];
  const nodes = readdirSync(nodesDir).filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(nodesDir, f), "utf8")) as CodexNode)
    .sort((a, b) => `${a.created_at ?? ""}\0${a.id}`.localeCompare(`${b.created_at ?? ""}\0${b.id}`));

  const idMap = new Map(nodes.map((n, i) => [n.id, formatId(i + 1)]));
  for (const [slug, id] of idMap) report.push(`- 编号映射：${slug} → ${id}（D5：slug 换成顺序编号，名字进 name）`);

  const ideas: Idea[] = nodes.map((n) => {
    const id = idMap.get(n.id)!;
    const folded = CODEX_STATUS[n.status ?? "draft"] ?? "todo";
    if ((n.status ?? "draft") !== folded) {
      report.push(`- ${id}: 状态 ${n.status} 折叠为 ${folded}（D4：八态压四态${n.status === "superseded" ? "；superseded=废弃，保号置 blocked" : ""}）`);
    }
    const needs = (n.depends_on ?? []).flatMap((slug) => {
      const mapped = idMap.get(slug);
      if (!mapped) report.push(`- ${id}: 前置 ${slug} 在节点目录里不存在，已丢弃`);
      return mapped ? [mapped] : [];
    });
    if ((n.code_refs ?? []).some((c) => c.role)) {
      report.push(`- ${id}: code_refs.role 不进新格式，已丢弃（D2）`);
    }
    const [first, ...rest] = n.verification ?? [];
    for (const extra of rest) {
      report.push(`- ${id}: 第二个及之后的 verification（${extra.id ?? "?"}：${extra.plan ?? ""}）不进新格式 —— 一个想法一个验收（D2）`);
    }
    const verify: Verify | undefined = !first ? undefined
      : first.kind === "manual"
        ? { manual: first.plan ?? "", signed_off: null }
        : {
            command: Array.isArray(first.command) ? first.command.join(" ") : first.command ?? "",
            test_files: first.test_paths ?? [],
            pass: "exit 0",
          };
    return {
      id, name: n.name ?? n.id, status: folded,
      ...(needs.length ? { needs } : { needs: [] }),
      what: n.what ?? "", why: n.why ?? "", expected: n.expected_result ?? "",
      how: n.implementation?.how ?? "", why_this_way: n.implementation?.why_this_way ?? "",
      ...(verify ? { verify } : {}),
      ...(n.code_refs?.length ? { code: n.code_refs.map((c) => ({
        file: c.path,
        ...(c.start_line && c.end_line ? { lines: `${c.start_line}-${c.end_line}` } : {}),
      })) } : {}),
      future: n.future_use ?? "",
      log: [{ date, by: "migrate", note: `迁自 codex 节点 ${n.id}` }],
    } as Idea;
  });

  report.push(`- endpoints 空着：旧格式没有终点概念（D6），需要人来定`);
  const graph: Graph = { version: 1, project: projectName, next_id: ideas.length + 1, endpoints: [], ideas };
  return { text: stringify(graph), graph, report };
}

function convertLegacyYaml(text: string, kind: LegacyKind, date: string): { text: string; graph: Graph; report: string[] } {
  const report: string[] = [];
  const doc = parseDocument(text);
  if (doc.has("agent")) {
    report.push(`- 去掉 agent: ${String(doc.get("agent"))} 键（D10：图归项目，不归 agent）`);
    doc.delete("agent");
  }
  for (const key of ["enforce", "exempt"]) {
    if (doc.has(key)) {
      report.push(`- 去掉 ${key}: 键（D24/D25：图内不设 agent 可改的开关）`);
      doc.delete(key);
    }
  }
  const graph = doc.toJSON() as Graph;
  if (graph.next_id === undefined) {
    const highest = graph.ideas.reduce((m, i) => Math.max(m, idNumber(i.id) || 0), 0);
    writeNextId(doc, highest + 1);
    report.push(`- 初始化取号计数器 next_id: ${highest + 1}（用过的最大编号加一）`);
  }
  report.push(`- 迁自 graph.${kind}.yaml（${date}），注释原样保留`);
  return { text: String(doc), graph: doc.toJSON() as Graph, report };
}

/** One line per legacy graph: which kind, how many ideas, where. Shared by every
 *  refusal that has to say what is waiting (I-101). */
function legacyLines(sources: LegacySource[]): string[] {
  return sources.map((s) => {
    try {
      const count = s.kind === "codex"
        ? readdirSync(s.path).filter((f) => f.endsWith(".json")).length
        : ((parseDocument(readFileSync(s.path, "utf8")).toJSON() as Graph)?.ideas ?? []).length;
      return `  ${s.kind}: ${count} 个想法（${s.path}）`;
    } catch { return `  ${s.kind}: 读不出来（${s.path}）`; }
  });
}

export function migrate(
  projectDir: string,
  opts: { pick?: LegacyKind; dryRun?: boolean; date: string },
): MigrateResult {
  const plain = graphPath(projectDir);
  const sources = findLegacySources(projectDir);
  // H15: look at the file before refusing. "Already exists" is true of a legacy
  // graph parked on the canonical name too, and it is the wrong sentence — the
  // human step there is a rename, not "nothing to do".
  const occupied = sources.find((s) => s.instruction);
  if (occupied) return { ok: false, reason: occupied.instruction };
  // No legacy graph anywhere is the whole answer, whether or not a project graph
  // exists — asking about graph.yaml first produced a sentence about the wrong
  // file (I-101).
  if (sources.length === 0) {
    return { ok: false, reason: "没有发现旧格式的图（ideas/graph.claude.yaml / ideas/graph.cursor.yaml / .codex-companion/nodes）" };
  }
  // I-101: an existing graph.yaml used to mean "nothing to migrate onto" — said
  // of a 68-byte installer seed sitting beside a 148 KB legacy graph, in three
  // repositories at once. The file's EXISTENCE proves nothing; its contents do.
  // A seed with no ideas holds no information, and the one step that would
  // free it (moving the file aside) is a step no agent can take (D21), so it
  // is migrated over and the report says so. A graph WITH ideas is refused —
  // the engine never merges two graphs (D10) — but the refusal names what is
  // waiting, how much of it, and which file the human moves. An unreadable
  // graph is refused too: "could not parse" must never be read as "empty".
  let seedNote: string | null = null;
  if (existsSync(plain)) {
    let count: number | null;
    try {
      // parseDocument is lenient: a broken file comes back as a PARTIAL document
      // with its errors listed, not as a throw — and a partial document counted
      // one idea in a file that has none readable. Ask for the errors.
      const doc = parseDocument(readFileSync(plain, "utf8"));
      if (doc.errors.length > 0) throw doc.errors[0];
      count = ((doc.toJSON() as Graph)?.ideas ?? []).length;
    } catch { count = null; }
    if (count === null) {
      return { ok: false, reason: `ideas/graph.yaml 读不出来（YAML 解析失败）—— 不能当成空种子覆盖。请人先看这个文件，修好或挪开，再跑 migrate。` };
    }
    if (count > 0) {
      return {
        ok: false,
        reason: `ideas/graph.yaml 已有 ${count} 个想法，旁边还留着没迁的旧图：\n${legacyLines(sources).join("\n")}\n`
          + `引擎不合并两张图（D10）—— 要迁旧图，请人先把 ideas/graph.yaml 挪开再跑 migrate；要保留现图，把旧图挪走。`,
      };
    }
    seedNote = "- 覆盖了只有种子、没有想法的 ideas/graph.yaml（安装器种下的空种子）";
  }
  if (sources.length > 1 && !opts.pick) {
    return {
      ok: false,
      reason: `发现多份旧图，不自动挑赢家（D10）—— 人用 --pick claude|cursor|codex 明示选择或先手工合并：\n${legacyLines(sources).join("\n")}`,
    };
  }
  const chosen = sources.length === 1 ? sources[0] : sources.find((s) => s.kind === opts.pick);
  if (!chosen) return { ok: false, reason: `--pick ${opts.pick} 没有对应的旧图` };

  const projectName = resolve(projectDir).split(/[\\/]/).pop() ?? "project";
  const converted = chosen.kind === "codex"
    ? convertCodex(chosen.path, projectName, opts.date)
    : convertLegacyYaml(readFileSync(chosen.path, "utf8"), chosen.kind, opts.date);

  // Nothing reaches the disk unless the converted graph still validates.
  // Missing code files are the target repo's history, not a conversion bug.
  const { errors } = check(converted.graph, projectDir);
  const real = errors.filter((e) => !/code file not found/.test(e));
  if (real.length > 0) {
    return { ok: false, reason: `迁出来的图没通过校验，一个字都没写：\n${real.map((e) => `  - ${e}`).join("\n")}`, report: converted.report };
  }
  if (seedNote) converted.report.push(seedNote);
  if (opts.dryRun) return { ok: true, report: converted.report };

  mkdirSync(IDEAS_DIR(projectDir), { recursive: true });
  atomicWrite(plain, converted.text);
  atomicWrite(join(IDEAS_DIR(projectDir), "migrate-report.md"),
    `# 迁移报告（${opts.date}，来源：${chosen.kind}）\n\n没能无损转换的内容，逐条列在这里：\n\n${converted.report.join("\n")}\n`);
  return { ok: true, written: plain, report: converted.report };
}

// ─── set ────────────────────────────────────────────────────────────────────

// D19: fewer statuses does not mean no lifecycle. Everything else is refused.
const TRANSITIONS: Record<Status, Status[]> = {
  todo: ["doing", "blocked"],
  doing: ["done", "blocked"],
  blocked: ["todo", "doing"],
  done: ["blocked"],           // a regression reopens it; nothing else moves done
};

export function setStatus(
  doc: Document, graph: Graph, id: string, status: Status,
  entry: { by?: string; note?: string; date: string },
  // With a projectDir the done-gate also demands current GREEN evidence (D20).
  // The doing-gate reads the graph only (D17, revised 2026-09-16 / I-146).
  projectDir?: string,
): void {
  const index = graph.ideas.findIndex((i) => i.id === id);
  if (index < 0) throw new Error(`no idea with id ${id}`);
  if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join(" | ")}`);

  const idea = graph.ideas[index];
  const from = (idea.status ?? "todo") as Status;
  if (!TRANSITIONS[from].includes(status)) {
    throw new Error(`${id}: ${from} → ${status} 不在转移表里（todo→doing|blocked, doing→done|blocked, blocked→todo|doing, done→blocked）`);
  }
  if (status === "doing") {
    const notReady = isBuildReady(idea);
    if (notReady) throw new Error(`${id}: cannot be doing — ${notReady}. 先把想法想清楚（/ccthink）`);
    const unmet = needsUnmet(idea, graph);
    if (unmet) throw new Error(`${id}: cannot be doing — ${unmet}`);
    const clash = fileClash(idea, graph);
    if (clash) throw new Error(`${id}: cannot be doing — ${clash}`);
    // 2026-09-16（I-146）：进 doing 不再要人工批准。八问填齐、前置完成、路径不冲突，
    // 三条都是图里的事实，够了；人想看计划，打开渲染出的网页看，不对就 set 回 todo。
  }
  if (status === "done") {
    if (!idea.code?.length) throw new Error(`${id}: cannot be done without \`code\` — say where it lives`);
    if (!idea.verify) throw new Error(`${id}: cannot be done without \`verify\``);
    if (idea.verify.manual && !idea.verify.signed_off) {
      throw new Error(`${id}: manual check — a human must fill \`verify.signed_off\` before done`);
    }
    if (projectDir && idea.verify.command && !greenCurrent(projectDir, graph, id)) {
      throw new Error(`${id}: 完成前必须有当前有效的 GREEN —— run-check ${id} --phase green（实现每改一次、测试每变一次都要重跑）`);
    }
    // I-135, the fifth door. A parent is not finished while anything filed under
    // it is unfinished — containment implies it. This rule used to live as prose
    // on the parents themselves ("all seven children are done"), which nobody
    // counted and which went stale the moment somebody filed an eighth. Reads
    // the graph and nothing else, so the pure unit path sees it too.
    const openKids = childrenUnfinished(idea, graph);
    if (openKids) throw new Error(`${id}: cannot be done — ${openKids}`);
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
  /** Manual signatures the envelope ASKED for. Nothing is written for these —
   *  the caller turns each into a one-time manual-check challenge (D27). */
  signRequests?: SignRequest[];
}

/** One `sign` op, carried out of the write-back as a request instead of a write. */
export interface SignRequest { id: string; who: string; words: string }

const CHANGE_VERSION = 1;

/** Editing one of these on a finished idea means the idea itself changed. */
const BEHAVIOUR_FIELDS = ["what", "expected", "how", "why_this_way", "verify"];

/** What a new idea may bring with it. Everything else is stripped — a change
 *  file must not be able to conjure a `done` idea with a forged signature. */
const NEW_IDEA_FIELDS = ["name", "what", "why", "expected", "how", "why_this_way", "future", "parent"];

/** What a `set` may reach: the name, the six prose answers the browser puts in
 *  a text box, and `parent` (an id, handled by the branch below, not prose).
 *  D24 — `status`, `verify` (and with it `signed_off`), `code`
 *  and `log` are lifecycle, and lifecycle only moves through the CLI. Without
 *  this list a `set` on `status` is a `done` with no gate at all: it writes a
 *  folded scalar that reads back as a perfectly valid status. */
const SET_FIELDS = ["name", "what", "why", "expected", "how", "why_this_way", "future", "parent"];

/** `parent` is an id, not prose: it is compared by exact value against other
 *  ideas' ids, so it is stored as one plain line — a folded block would read
 *  back with a trailing newline and match nothing. */
const fieldNode = (doc: Document, field: string, value: unknown) =>
  field === "parent" ? String(value ?? "").trim() : proseNode(doc, value);

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

export function applyChanges(
  source: string, envelope: unknown, today: string,
  // Where the approval receipts and the evidence live. Both real callers (the
  // `apply` command and `serve`) know it, so a status op out of an envelope
  // meets exactly the gates the `set` subcommand meets (D17/D20). Optional only
  // for pure unit use of the write-back — and that use may not reach `doing`.
  projectDir?: string,
): ApplyResult {
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
  // I-129: `parent` is an id too — the fifth place a temporary id can sit: as
  // the value of a `set parent` and inside a new idea's own fields.
  const addFields = (op: Record<string, unknown>) =>
    op.op === "add" && op.fields && typeof op.fields === "object" ? op.fields as Record<string, unknown> : undefined;
  for (const op of ops) {
    for (const key of ["id", "tmp", "from", "to"]) {
      if (op[key] !== undefined) op[key] = resolve(op[key])!;
    }
    if (op.op === "set" && op.field === "parent" && typeof op.new === "string") op.new = resolve(op.new)!;
    const fields = addFields(op);
    if (fields && typeof fields.parent === "string") fields.parent = resolve(fields.parent)!;
  }
  const tmpIn = (o: Record<string, string>) =>
    ["id", "tmp", "from", "to"].map((k) => o_(o, k)).find((v) => v)
    ?? (o.op === "set" && o.field === "parent" ? o_(o, "new") : undefined)
    ?? o_((addFields(o) ?? {}) as Record<string, string>, "parent");
  const leftover = ops.find((o) => tmpIn(o));
  if (leftover) {
    return { ok: false, reason: `改动里还剩没有发到编号的临时号（${leftover.op} 上的 ${tmpIn(leftover)}），整体拒绝` };
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
      node.set(f, fieldNode(doc, f, fields[f]));
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
      // D20: `done` needs a GREEN that is still current, and that evidence sits
      // on disk — a pure write-back cannot read it, and nothing downstream
      // re-checks. So this path never hands out `done`, whatever the envelope
      // says; the person finishes an idea where the evidence is.
      if (op.to === "done") {
        return {
          ok: false,
          reason: `${op.id}: 网页改不出 done —— 完成要有当前有效的 GREEN 证据（D20）：`
            + `先 run-check ${op.id} --phase green，再 set ${op.id} done，整体拒绝`,
        };
      }
      try {
        setStatus(doc, doc.toJSON() as Graph, op.id!, op.to as Status,
          { by: "apply", note: `网页上改的状态：${op.from} → ${op.to}`, date: today }, projectDir);
      } catch (error) {
        return { ok: false, reason: String(error instanceof Error ? error.message : error) };
      }
      changed.push(`${op.id} 状态 ${op.from} → ${op.to}`);
      continue;
    }

    // D24: a field edit is a field edit. Anything outside this list is lifecycle
    // dressed up as prose, and lifecycle has its own gates.
    if (!SET_FIELDS.includes(op.field!)) {
      return {
        ok: false,
        reason: `改动想改 ${op.id} 的 ${op.field} —— 写回只认这几个字段：${SET_FIELDS.join("、")}；`
          + `状态、验证方式、签字这些只能走命令行（D24），整体拒绝`,
      };
    }
    doc.setIn(["ideas", index, op.field!], fieldNode(doc, op.field!, op.new));
    changed.push(`${op.id} · ${op.field}`);

    // A finished idea whose behaviour changed is not finished any more. Without
    // this, the guard waves through its code files (it short-circuits on done)
    // and the new idea gets built with no test and no approval. It goes to
    // blocked, not doing: done → doing is not in the transition table (D19),
    // and an idea whose plan just changed under it is not one you may build.
    if (idea.status === "done" && BEHAVIOUR_FIELDS.includes(op.field!)) {
      setStatus(doc, doc.toJSON() as Graph, op.id!, "blocked", {
        by: "apply", date: today,
        note: `已完成的想法被改了 ${op.field}，自动退回 blocked —— 想清楚再走一遍 doing，测试先行、人批准三条规则对它重新生效`,
      }, projectDir);
      changed.push(`${op.id} 因行为字段被改，退回 blocked`);
    }
  }

  // ── phase 2b: signature requests ─────────────────────────────────────────
  // D27: a manual check is the one thing a machine may not conclude, and a
  // change file is not a person — an agent can write one and run the write-back
  // from Bash. So the envelope only ASKS. The graph gets `signed_off` from
  // applyApproval, when the human's whole message answers a one-time challenge,
  // and from nowhere else. This closes the conflict FORMAT.md recorded as open
  // under D27 on 2026-08-31.
  const signRequests: SignRequest[] = [];
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

    signRequests.push({ id: op.id!, who, words });
    changed.push(`${op.id} 请求人工验证签字（${who}）—— 还没写进图，等人回一次性口令`);
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
    writeNextId(doc, nextId);
  }

  // ── nothing reaches the disk until the whole graph still validates ───────
  const after = doc.toJSON() as Graph;
  if (!after || !Array.isArray(after.ideas)) return { ok: false, reason: "应用之后的图读不出来了" };
  const { errors } = check(after, ".");
  const real_errors = errors.filter((e) => !/code file not found/.test(e));
  if (real_errors.length > 0) {
    return { ok: false, reason: `应用之后图校验不过，整体放弃：\n  - ${real_errors.join("\n  - ")}` };
  }

  return { ok: true, text: String(doc), changed, signRequests };
}

/**
 * Turn the signatures an envelope asked for into one-time manual-check
 * challenges (D27). Called after the graph is written, by whoever did the
 * writing — this is the disk-touching half the pure write-back refuses to do.
 * Returns one line per request, for the person to read.
 */
export function requestSignatures(
  projectDir: string, graph: Graph, requests: SignRequest[], date: string,
): string[] {
  return requests.map((r) => {
    try {
      const { challenge } = requestApproval(projectDir, graph, "manual-check", [r.id], { by: r.who, date });
      return `${r.id} 的人工验证要人亲口签：整条消息回一句「批准 ${challenge}」，签字才会写进图`
        + `（网页上写的原话：「${r.words}」）`;
    } catch (error) {
      return `${r.id} 的签字请求没发出去：${error instanceof Error ? error.message : String(error)}`;
    }
  });
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

/**
 * The eight questions, in order, in the ONE wording D11 settled on. Every place
 * that asks a question reads its words from here: the card, the CLI's `show`,
 * and anything added later. Three copies of these labels used to live in this
 * one file, drifting apart — which is the exact drift D11 exists to prevent.
 *
 * `prose` marks the six answers that are plain text a person retypes in the
 * browser; questions 6 and 7 are rendered from `code` and `verify` structures.
 */
export const QUESTIONS = [
  { n: 1, key: "what",         prose: true,  label: "是什么" },
  { n: 2, key: "why",          prose: true,  label: "为什么有这个想法" },
  { n: 3, key: "expected",     prose: true,  label: "预期结果" },
  { n: 4, key: "how",          prose: true,  label: "如何实现" },
  { n: 5, key: "why_this_way", prose: true,  label: "为什么这样实现" },
  { n: 6, key: "code",         prose: false, label: "代码在哪" },
  { n: 7, key: "verify",       prose: false, label: "如何验证" },
  { n: 8, key: "future",       prose: true,  label: "未来怎么用" },
] as const;

/** One question's wording, by its number. */
const askedAs = (n: number) => QUESTIONS[n - 1].label;

/** The six prose answers a person can retype in the browser — straight off the
 *  one list above, never a second hand-kept copy of the same words. */
const PROSE = QUESTIONS.filter((q) => q.prose) as readonly { key: string; label: string }[];

/** Question 6 as one line. Deliberately NOT shared with the card's `codeOf`:
 *  that one separates with a middle dot and a line break and says 尚未实现 when
 *  empty, this one uses parentheses, commas and an em dash. Merging them is a
 *  visible product change and does not belong inside I-102. */
export function codeText(code?: CodeRef[]): string {
  return (code ?? [])
    .map((c) => `${c.file}${c.lines ? ":" + c.lines : ""}${c.symbol ? ` (${c.symbol})` : ""}`)
    .join(", ");
}

/**
 * Question 7, all five fields. Before I-102 no surface printed them all:
 * `show` printed `command ?? manual` and nothing else, the browser card had
 * `pass` and `signed_off` but never `test_files`. `test_files` is the one that
 * hurt — the approval digest covers it, so editing it voids a token, and the
 * human could not see the field that did it (D31).
 */
export function verifyText(v?: Verify): string {
  if (!v) return "";
  const bits: string[] = [];
  if (v.command) bits.push(v.command);
  if (v.pass) bits.push(`通过条件：${v.pass}`);
  if (v.test_files?.length) bits.push(`测试文件：${v.test_files.join("、")}`);
  if (v.manual) bits.push(`人工检查：${v.manual}`);
  if (v.signed_off) bits.push(`签字：${v.signed_off}`);
  return bits.join("\n");
}

/** The eight answers, one block each, as `show` has always laid them out:
 *  `N 标签`, then the answer indented two spaces with its own line breaks kept.
 *
 *  It reads the eight keys and NOTHING else — that is the point, not an
 *  accident. `show` hands it a whole Idea and the approval prompt hands it a
 *  projection entry; because the parameter type admits only the eight answers,
 *  neither caller can leak a field the approval digest does not cover (I-102).
 */
export function questionLines(
  x: Partial<Pick<Idea, "what" | "why" | "expected" | "how" | "why_this_way" | "future" | "code" | "verify">>,
): string[] {
  return QUESTIONS.map((q) => {
    const value = q.key === "code" ? codeText(x.code)
      : q.key === "verify" ? verifyText(x.verify)
        : x[q.key as "what"];
    return `${q.n} ${q.label}\n  ${(value || "—").trim().replace(/\n/g, "\n  ")}`;
  });
}

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
    "classDef done fill:#e1eee4,stroke:#7c9b83,color:#356548;",
    "classDef doing fill:#e2edf2,stroke:#8aa9b9,color:#37617b;",
    "classDef todo fill:#f0f2ed,stroke:#a4afa2,color:#52604f,stroke-dasharray:5 3;",
    "classDef blocked fill:#f5ead9,stroke:#c2a477,color:#855a26,stroke-dasharray:2 2;",
    "classDef endpoint fill:#eee6f1,stroke:#b49bbd,color:#765286,stroke-width:3px;"
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

  // The tree (FORMAT.md, "The tree"). One page per idea, addressed by hash:
  // `#I-107` shows I-107's own card on top and its children below, drawn like
  // the home page draws the top level. A `parent` nobody has is treated as
  // top level here — the page must not lose an idea; `check` reports it.
  const parentKey = (i: Idea) => filedUnder(map, i);
  const ordered = topoOrder(g);                 // I-061: siblings stay in dependency order
  const kidsOf = (owner: string) => ordered.filter((i) => parentKey(i) === owner);
  const descendants = (owner: string): Idea[] => kidsOf(owner).flatMap((k) => [k, ...descendants(k.id)]);

  // The diagram shows the current page's children, names only — detail lives
  // one click away. This is the home page's; the script redraws per page.
  const mermaid = buildMermaidSource({ ...g, ideas: kidsOf("") });

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
    if (v.command) return `<code>${esc(v.command)}</code>${v.pass ? ` → ${esc(v.pass)}` : ""}${testFilesOf(v)}${
      v.signed_off ? `<br><span class="signoff">人工签字：${esc(v.signed_off)}</span>` : ""}`;
    // The sign button appears only where a signature would mean something: a
    // manual check nobody has signed yet. `data-manual` carries the exact
    // sentence, so the panel can show what is being attested to.
    //
    // I-135: while anything filed under this idea is unfinished, the button is
    // greyed — and still there. A control that vanishes is the one complaint
    // Jira and Redmine users file about this rule despite unrelated
    // architectures: you cannot tell a rule from a broken page. It carries no
    // `data-sign`, so the panel that opens on that attribute never opens; the
    // reason sits next to it in words rather than in a tooltip nobody hovers.
    const openKids = childrenUnfinished(i, g);
    const sign = !awaitingSignature(i) ? ""
      : openKids
        ? `<button class="sign-open" disabled>人工签字</button><span class="gate-why">${esc(openKids)}</span>`
        : `<button class="sign-open" data-sign="${attr(i.id)}" data-manual="${attr(v.manual)}">人工签字</button>`;
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
  const countsOf = (ideas: Idea[]) => STATUSES.map((s) => `${STATUS_ZH[s]} ${tally(ideas).by[s]}`).join(" · ");

  /**
   * I-103: the challenges still waiting for an answer, on the home page only.
   * Read from disk at render time (a live `serve` page; never the redraw file,
   * which is a dead file that gets sent around — `projectDir` is empty there).
   * Same three-layer defence as validApproval: no dir → nothing; a file that
   * will not parse is skipped, not fatal. Content is RE-PROJECTED from the
   * current graph: if it no longer matches the stored digest the challenge is
   * shown as void, so nobody copies a token that `applyApproval` will refuse.
   */
  const pendingPanel = (): string => {
    if (!projectDir) return "";
    const files: string[] = [];
    for (const dir of [pendingDir(projectDir), legacyPendingDir(projectDir)]) {
      if (existsSync(dir)) for (const name of readdirSync(dir).sort()) files.push(join(dir, name));
    }
    const rows: string[] = [];
    for (const file of files) {
      const name = file.slice(file.lastIndexOf(file.includes("\\") ? "\\" : "/") + 1);
      let p: { challenge?: string; gate?: string; snapshots?: Record<string, string> };
      try { p = JSON.parse(readFileSync(file, "utf8")); } catch { continue; }
      const code = String(p.challenge ?? name.replace(/\.json$/, ""));
      const ids = Object.keys(p.snapshots ?? {});
      const drifted = ids.length === 0 || ids.some((id) => {
        try { return approvalSnapshot(g, id) !== p.snapshots![id]; } catch { return true; }
      });
      const body = drifted ? "" : approvalLines(approvalProjection(g, ids)).join("\n");
      rows.push(`<div class="pending-row${drifted ? " void" : ""}"><div class="pending-head"><code>${esc(code)}</code> · ${
        esc(String(p.gate ?? ""))} · ${ids.map((id) => `<a class="xlink" href="#${esc(id)}" data-goto="${esc(id)}">${esc(id)}</a>`).join(" ")}${
        drifted ? '<span class="badge">已作废</span><span class="wl-note">被批的内容在请求之后改过了，这个口令回了也会被拒 —— 重新 request-approval</span>'
          : `<span class="wl-note">看完下面的全文，把这一句整条回到对话里：</span><code class="answer">批准 ${esc(code)}</code>`}</div>${
        drifted ? "" : `<pre class="pending-text">${esc(body)}</pre>`}</div>`);
    }
    if (rows.length === 0) return "";
    return `<details class="worklist pending"><summary>正在等你批 (${rows.length})</summary>
  <p class="wl-note">这一句只能由人在对话里亲手回，页面上点什么都不算数。</p>
  ${rows.join("\n  ")}
</details>`;
  };
  const pendingHtml = pendingPanel();

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
  <dl>${field(i, "parent", "父想法")}${PROSE.slice(0, 5).map((q) => field(i, q.key, q.label)).join("")}
    <dt>${askedAs(6)}</dt><dd>${codeOf(i)}</dd>
    <dt>${askedAs(7)}</dt><dd>${verifyOf(i)}</dd>${field(i, "future", askedAs(8))}
  </dl>
  <p class="edges needs" data-needs-of="${attr(i.id)}"><b>前置想法</b> <span class="chips">${
    (i.needs ?? []).filter((n) => map.has(n)).map((n) => needChip(n, i.id)).join("") || NONE
  }</span>${linkPicker(i)}</p>
  <p class="edges"><b>它是这些想法的前置</b> ${links(dependents(g, i.id))}</p>
  ${i.log?.length ? `<details class="log"><summary>修改记录 (${i.log.length})</summary>${i.log.map((l) =>
    `<div>${esc(l.date)}${l.by ? " · " + esc(l.by) : ""} — ${esc(l.note)}</div>`).join("")}</details>` : ""}
</section>`;

  // One row per child on its parent's page (I-117): a collapsible whose summary
  // is name, status, the first line of `what` and the way in, and whose body is
  // a READ-ONLY digest of the eight answers. The editable card still lives on
  // the child's own page and nowhere else: the body carries no `id`, no
  // `data-idea` and no `section.idea`, so editing, drafts and signing — all of
  // which find elements by id — never see a second copy.
  // I-103: the two web faces list `test_files` (the terminal always has, via
  // verifyText) and a command idea that carries a signature shows it — before,
  // the early return on `command` hid both.
  const testFilesOf = (v: Verify) => v.test_files?.length
    ? `<br><span class="testfiles">测试文件：${v.test_files.map((f) => `<code>${esc(f)}</code>`).join("、")}</span>` : "";
  const verifyPlain = (i: Idea) => {
    const v = i.verify;
    if (!v) return NONE;
    if (v.command) return `<code>${esc(v.command)}</code>${v.pass ? ` → ${esc(v.pass)}` : ""}${testFilesOf(v)}${
      v.signed_off ? `<br><span class="signoff">人工签字：${esc(v.signed_off)}</span>` : ""}`;
    return `${esc(v.manual)}<br><span class="signoff">人工签字：${v.signed_off ? esc(v.signed_off) : "未签"}</span>`;
  };
  const briefDetail = (i: Idea) => `<div class="brief-detail"><dl>
    <dt>父想法</dt><dd>${i.parent && map.has(i.parent) ? links([i.parent]) : NONE}</dd>${PROSE.slice(0, 5).map((q) =>
    `<dt>${q.label}</dt><dd>${esc(i[q.key as keyof Idea]) || NONE}</dd>`).join("")}
    <dt>${askedAs(6)}</dt><dd>${codeOf(i)}</dd>
    <dt>${askedAs(7)}</dt><dd>${verifyPlain(i)}</dd>
    <dt>${askedAs(8)}</dt><dd>${esc(i.future) || NONE}</dd>
  </dl>
  <p class="edges"><b>前置想法</b> ${links((i.needs ?? []).filter((n) => map.has(n)))}</p>
  <p class="edges"><b>它是这些想法的前置</b> ${links(dependents(g, i.id))}</p>
  ${i.log?.length ? `<div class="brief-log"><b>修改记录</b>${i.log.map((l) =>
    `<div>${esc(l.date)}${l.by ? " · " + esc(l.by) : ""} — ${esc(l.note)}</div>`).join("")}</div>` : ""}
  </div>`;
  const brief = (i: Idea) => `<details class="brief-row ${cls(i)}" data-row="${attr(i.id)}"><summary class="brief">
    <span class="bname">${esc(i.name)}</span><span class="badge">${esc(STATUS_ZH[i.status ?? "todo"])}</span>${
    ends.has(i.id) ? '<span class="badge end">终点</span>' : ""}<span class="blurb">${
    esc(String(i.what ?? "").split("\n")[0].trim())}</span><a class="enter" href="#${esc(i.id)}" data-brief="${attr(i.id)}">进入 →</a></summary>
${briefDetail(i)}</details>`;

  /** One page: the home page (`owner` null) or one idea's. Sections are all in
   *  the document, hidden; the script shows the one the hash names. */
  const page = (owner: Idea | null) => {
    const id = owner ? owner.id : "";
    const kids = kidsOf(id);
    const scope = descendants(id);
    return `<section class="page" id="page-${esc(owner ? owner.id : "root")}" hidden>
${owner ? card(owner) : ""}
${kids.length === 0 && owner ? "" : `<p class="legend">${esc(countsOf(scope))} · 点击图上的节点，定位到下面对应的那一行；点行本身展开，点「进入」才换页</p>
${owner ? "" : pendingHtml}
${worklist("待人工验证", scope.filter(awaitingSignature).map((i) => ({
  id: i.id, name: i.name, note: i.verify?.manual ?? "",
})))}
${worklist("进行中", scope.filter((i) => i.status === "doing").map((i) => {
  const waiting = waitingOn(i).map((n) => map.get(n)!.name || n);
  // A plain sentence, not the dash that means "no information": this says one
  // definite thing — no other idea is in the way. It does NOT say somebody is
  // working on it.
  return { id: i.id, name: i.name, note: waiting.length ? `在等 ${waiting.join("、")}` : "没有前置挡着它" };
}))}`}
<h2>${owner ? "子想法" : "顶层想法"} <span class="legend">按依赖顺序排列</span></h2>
<div class="children">${kids.map(brief).join("\n")}</div>
</section>`;
  };

  // The header's two lines follow whichever page is showing (I-086); the script
  // repaints them, this renders the home page's state so a first paint — and a
  // reader with no script — still sees the project rather than nothing.
  // `overview: >` folds a blank line into ONE newline, so paragraphs split on
  // `\n`. Splitting on a blank line finds one part in every real graph and the
  // fold would silently never appear.
  const paragraphs = (s: unknown) => String(s ?? "").split("\n").map((t) => t.trim()).filter(Boolean);
  const overview = paragraphs(g.overview);

  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(g.project ?? "idea graph")} — 想法图</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif; margin:0 auto; max-width:1060px;
    padding:28px 22px 80px; background:#f7f6f2; color:#293d36; }
  h1 { margin:0 0 6px; font-size:22px; }
  .overview { color:#63746a; margin:0 0 18px; }
  .overview-more { color:#63746a; font-size:13px; margin:-10px 0 18px; }
  .overview-more summary { cursor:pointer; }
  .overview-more p { margin:6px 0 0; }
  .legend { font-size:13px; color:#63746a; margin:0 0 4px; }
  .sw { display:inline-block; width:11px; height:11px; border-radius:3px; vertical-align:-1px; margin:0 5px 0 12px; }
  .sw:first-child { margin-left:0; }
  .graph { background:#ffffff; border:1px solid #dce2d9; border-radius:10px; margin:14px 0 26px; position:relative; }
  /* Pan/zoom: the viewport clips, the canvas is what gets transformed. */
  .viewport { overflow:hidden; height:min(72vh,760px); touch-action:none; cursor:grab; border-radius:10px; }
  .viewport.dragging { cursor:grabbing; }
  /* Only ever translated — never scaled. A CSS scale() would rasterise the
     layer once and stretch that bitmap, which is exactly what looks blurry. */
  .canvas { transform-origin:0 0; will-change:transform; display:inline-block; padding:0; line-height:0; }
  .canvas svg { max-width:none !important; display:block; }
  .graph-tools { position:absolute; top:10px; right:10px; z-index:2; display:flex; gap:4px; align-items:center;
    background:#ffffffee; border:1px solid #dce2d9; border-radius:8px; padding:4px 6px; backdrop-filter:blur(4px); }
  .graph-tools button { width:26px; height:24px; font-size:13px; line-height:1; cursor:pointer;
    background:#f0f2ed; color:#293d36; border:1px solid #dce2d9; border-radius:5px; padding:0; }
  .graph-tools button:hover { border-color:#356b58; color:#356b58; }
  .graph-tools button.wide { width:auto; padding:0 8px; font-size:12px; }
  .zoom-level { font-size:11px; color:#63746a; min-width:38px; text-align:right; font-variant-numeric:tabular-nums; }
  .graph-hint { font-size:11px; color:#63746a; padding:0 14px 10px; }
  h2 { border-bottom:1px solid #dce2d9; padding-bottom:7px; font-size:17px; margin-top:34px; }
  .idea { border:1px solid #dce2d9; border-left:4px solid #ccdacd; border-radius:9px;
    padding:14px 18px; margin:12px 0; scroll-margin-top:14px; }
  .idea.done { border-left-color:#e1eee4; } .idea.doing { border-left-color:#e2edf2; }
  .idea.blocked { border-left-color:#f5ead9; } .idea.endpoint { border-left-color:#eee6f1; }
  .idea h3 { margin:0 0 10px; font-size:16px; }
  .idea.flash { animation: flash 1.2s ease-out; }
  @keyframes flash { from { background:#e0ebe4; } to { background:transparent; } }
  .badge { font-size:11px; padding:2px 8px; border-radius:10px; background:#dce2d9; color:#63746a;
    font-weight:normal; margin-left:8px; }
  .badge.end { background:#eee6f1; color:#faf5ff; }
  .iid { float:right; font-size:12px; color:#63746a; font-weight:normal; }
  dl { margin:0; display:grid; grid-template-columns:max-content 1fr; gap:5px 18px; }
  dt { color:#63746a; white-space:nowrap; } dd { margin:0; }
  code { background:#f0f2ed; border-radius:4px; padding:1px 6px; font-size:13px; }
  .none { color:#63746a; }
  .signoff { font-size:12px; color:#63746a; }
  .edges { margin:11px 0 0; font-size:13px; }
  .edges b { color:#63746a; font-weight:normal; margin-right:4px; }
  .xlink { display:inline-block; background:#f0f2ed; border:1px solid #dce2d9; border-radius:5px;
    padding:1px 8px; margin:2px 4px 2px 0; color:#356b58; text-decoration:none; font-size:12px; }
  .xlink:hover { border-color:#356b58; }
  .log { margin:10px 0 0; font-size:12px; color:#63746a; }
  .log summary { cursor:pointer; } .log div { margin:4px 0 0 14px; }

  /* ── editing ── read view and write view swap; only one is ever displayed. */
  .rw { display:none; }
  .idea.editing .ro { display:none; }
  .idea.editing .rw { display:inline-block; }
  .idea.editing dd .rw { display:block; }
  textarea.rw, input.rw, select.rw { width:100%; font:inherit; font-size:14px; color:#293d36;
    background:#ffffff; border:1px solid #dce2d9; border-radius:6px; padding:6px 8px; resize:vertical; }
  input.rw { width:auto; min-width:min(24em,100%); font-size:16px; }
  select.rw { width:auto; font-size:12px; padding:2px 6px; }
  textarea.rw:focus, input.rw:focus, select.rw:focus { outline:none; border-color:#356b58; }
  .edit-toggle { margin-left:8px; font:inherit; font-size:11px; cursor:pointer; padding:2px 9px;
    background:#f0f2ed; color:#63746a; border:1px solid #dce2d9; border-radius:10px; }
  .edit-toggle:hover { border-color:#356b58; color:#356b58; }
  /* 改过的地方要看得见 —— 提交之前，这是唯一的「哪里动过」的线索。 */
  .dirty > .rw, h3.dirty .rw { border-color:#855a26; background:#f5ead9; }
  dd.dirty::after { content:"已改"; font-size:11px; color:#855a26; margin-left:6px; }
  .idea.dirty { border-left-color:#855a26; }
  #draft-banner, #restore { border:1px solid #d7d8bc; background:#f5ead9; color:#855a26;
    border-radius:9px; padding:10px 14px; margin:0 0 14px; font-size:13px; }
  #restore { border-color:#d8c9df; background:#eee6f1; color:#765286; }
  #restore-list div { display:flex; gap:9px; align-items:center; margin:7px 0 0; }
  #restore-list span { flex:1; color:#a5a2b8; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  #restore button, #draft-banner button { font:inherit; font-size:11px; cursor:pointer; padding:2px 9px;
    background:#f0f2ed; color:#293d36; border:1px solid #dce2d9; border-radius:10px; }
  #restore button:hover, #draft-banner button:hover { border-color:#356b58; color:#356b58; }

  /* ── structure editing ── edges, new ideas, pending deletions. */
  .chip { display:inline-flex; align-items:center; gap:2px; margin:2px 4px 2px 0; }
  .chip .xlink { margin:0; border-top-right-radius:0; border-bottom-right-radius:0; }
  .cut { font:inherit; font-size:11px; line-height:1; cursor:pointer; padding:2px 6px;
    background:#f0f2ed; color:#63746a; border:1px solid #dce2d9; border-left:0;
    border-radius:0 5px 5px 0; }
  .cut:hover { color:#9a4a40; border-color:#9a4a40; }
  select.rw-edge { font:inherit; font-size:11px; margin-left:6px; padding:2px 6px; color:#63746a;
    background:#ffffff; border:1px solid #dce2d9; border-radius:10px; cursor:pointer; }
  select.rw-edge:hover { border-color:#356b58; color:#356b58; }
  #new-idea { font:inherit; font-size:12px; cursor:pointer; padding:3px 11px; margin-left:10px;
    background:#f0f2ed; color:#63746a; border:1px solid #dce2d9; border-radius:11px; vertical-align:2px; }
  #new-idea:hover { border-color:#356b58; color:#356b58; }
  .edit-toggle.danger:hover { border-color:#9a4a40; color:#9a4a40; }
  /* 待删是标记，不是消失 —— 人要能看见自己删了什么，并且改主意。 */
  .idea.removing { opacity:.55; border-left-color:#9a4a40; }
  .idea.removing h3 > .ro, .idea.removing h3 > .rw { text-decoration:line-through; }
  .idea.incomplete { border-left-color:#a16207; }
  .idea.incomplete::before { content:"前三问还没填齐，提交时不会带上它"; display:block;
    font-size:11px; color:#855a26; margin:0 0 6px; }
  /* ── worklists under the diagram ── */
  .worklist { border:1px solid #dce2d9; background:#ffffff; border-radius:9px;
    padding:9px 14px; margin:0 0 12px; font-size:13px; }
  .worklist > summary { cursor:pointer; color:#63746a; }
  .worklist > summary:hover { color:#356b58; }
  .pending-row { margin:10px 0 0; padding-top:8px; border-top:1px solid #dce2d9; }
  .pending-head { display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; }
  .pending-head .answer { user-select:all; color:#356b58; }
  .pending-row.void .badge { background:#e4cbc7; color:#9a4a40; }
  .pending-text { color:#765286; margin:6px 0 10px; padding-left:10px; border-left:2px solid #d8c9df;
    white-space:pre-wrap; font:inherit; max-height:60vh; overflow:auto; }
  .wl-row { display:flex; gap:10px; align-items:baseline; margin:7px 0 0; }
  .wl-row .xlink { margin:0; flex:none; }
  .wl-note { color:#63746a; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .crumbs { display:flex; align-items:center; gap:8px; font-size:14px; margin:0 0 12px; color:#63746a; }
  .crumbs a { color:#356b58; text-decoration:none; }
  .crumbs a.here { color:#293d36; font-weight:600; }
  .crumbs button { margin-left:auto; }
  .page[hidden] { display:none; }
  /* I-117: a row is a collapsible. The frame sits on the details element, the
     summary is the flex row, the body is the read-only digest. Collapsed by
     default means OMITTING the open attribute entirely — the attribute is a
     boolean, so any value at all, even a false-sounding one, renders it open.
     (No backticks in this block: the whole style sheet lives inside a template
     string; and this comment ships in the page, so it must not spell that
     value out either — a test greps the output for it.) */
  .brief-row { margin:0 0 8px; border:1px solid #dce2d9; border-left:4px solid #ccdacd; border-radius:9px;
    background:#ffffff; scroll-margin-top:14px; }
  .brief-row:hover { border-color:#356b58; }
  .brief-row.done { border-left-color:#527d63; } .brief-row.doing { border-left-color:#648aa0; }
  .brief-row.blocked { border-left-color:#b68748; } .brief-row.endpoint { border-left-color:#9b80a5; }
  .brief-row.flash { animation: flash 1.2s ease-out; }
  .brief { display:flex; gap:10px; align-items:baseline; padding:9px 14px; color:#293d36; cursor:pointer; list-style:none; }
  .brief::-webkit-details-marker { display:none; }
  .brief::before { content:"▸"; flex:none; color:#63746a; font-size:12px; }
  .brief-row[open] > .brief::before { content:"▾"; }
  .brief .bname { font-weight:600; flex:none; }
  .brief .blurb { flex:1; color:#63746a; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .brief .enter { flex:none; color:#356b58; font-size:13px; text-decoration:none; }
  .brief .enter:hover { text-decoration:underline; }
  .brief-detail { padding:2px 18px 12px 30px; border-top:1px solid #dce2d9; font-size:13px; color:#293d36; }
  .brief-detail dl { margin-top:8px; }
  .brief-log { margin:10px 0 0; font-size:12px; color:#63746a; }
  .brief-log b { color:#63746a; font-weight:normal; margin-right:6px; }
  .brief-log div { margin:4px 0 0 14px; }

  #offline-note { border:1px solid #d7d8bc; background:#f5ead9; color:#855a26;
    border-radius:9px; padding:10px 14px; margin:0 0 14px; font-size:13px; }

  /* ── submitting ── */
  #submit { font:inherit; font-size:11px; cursor:pointer; padding:2px 11px; margin-left:10px;
    background:#e1eee4; color:#f0fdf4; border:1px solid #527d63; border-radius:10px; }
  #submit:hover:not(:disabled) { border-color:#356548; }
  #submit:disabled { background:#f0f2ed; color:#63746a; border-color:#dce2d9; cursor:default; }
  #submit-panel { border:1px solid #cbdccf; background:#e1eee4; color:#356548;
    border-radius:9px; padding:12px 16px; margin:0 0 14px; font-size:13px; }
  #submit-panel ul { margin:8px 0; padding-left:20px; }
  #submit-panel li { margin:2px 0; color:#356548; }
  #submit-panel button { font:inherit; font-size:12px; cursor:pointer; padding:3px 12px; margin-top:8px;
    background:#e1eee4; color:#f0fdf4; border:1px solid #527d63; border-radius:10px; }
  #submit-panel button:hover { border-color:#356548; }
  #submit-panel textarea { width:100%; margin-top:8px; font-family:ui-monospace,monospace; font-size:11px;
    color:#293d36; background:#ffffff; border:1px solid #dce2d9; border-radius:6px; padding:6px 8px; }
  #submit-panel code { font-size:12px; }

  /* ── signing a manual check ── */
  .sign-open { font:inherit; font-size:11px; cursor:pointer; padding:2px 9px; margin-left:8px;
    background:#f0f2ed; color:#765286; border:1px solid #d8c9df; border-radius:10px; }
  .sign-open:hover:not(:disabled) { border-color:#765286; }
  /* I-135: greyed, not gone — the same shape as #submit:disabled, so "you may
     not do this yet" always looks the same on this page. */
  .sign-open:disabled { background:#f0f2ed; color:#63746a; border-color:#dce2d9; cursor:default; }
  .gate-why { font-size:12px; color:#63746a; margin-left:8px; }
  #sign-panel { border:1px solid #d8c9df; background:#eee6f1; color:#765286;
    border-radius:9px; padding:12px 16px; margin:0 0 14px; font-size:13px; }
  #sign-panel .what { color:#765286; margin:6px 0 10px; padding-left:10px; border-left:2px solid #d8c9df; }
  #sign-panel label { display:block; margin:8px 0 3px; font-size:12px; color:#765286; }
  #sign-panel input, #sign-panel textarea { width:100%; font:inherit; font-size:13px; color:#293d36;
    background:#ffffff; border:1px solid #dce2d9; border-radius:6px; padding:6px 8px; }
  #sign-panel button { font:inherit; font-size:12px; cursor:pointer; padding:3px 12px; margin-top:10px;
    background:#d8c9df; color:#f5f3ff; border:1px solid #d8c9df; border-radius:10px; }
  #sign-panel button:hover { border-color:#765286; }
  #sign-panel .warn { color:#9a4a40; font-size:12px; margin-top:6px; }
  /* Graph workspace: quiet surfaces, readable hierarchy, native controls. */
  body { max-width:1320px; padding:32px 48px 80px; background:#f7f6f2;
    color:#293d36; font-family:"Segoe UI","Microsoft YaHei",sans-serif; }
  body::before { content:"COMPANION / IDEA WORKSPACE"; display:block; margin-bottom:28px;
    color:#63746a; font-size:11px; font-weight:600; letter-spacing:2.4px; }
  h1 { font-size:clamp(26px,3vw,38px); font-weight:600; letter-spacing:-1px; line-height:1.3; margin-bottom:14px; }
  .overview { max-width:850px; font-size:15px; line-height:1.9; color:#63746a; margin-bottom:18px; }
  .overview-more { margin:0 0 24px; color:#63746a; }
  .overview-more p { max-width:850px; line-height:1.9; }
  .legend { color:#63746a; font-size:12px; line-height:1.9; }
  .sw { width:8px; height:8px; border-radius:50%; box-shadow:0 0 0 3px #344b3a0c; }
  .crumbs { margin:20px 0 0; padding:14px 0; border-top:1px solid #dce2d9; gap:12px; }
  .crumbs a { color:#356b58; }
  #new-idea { padding:8px 14px; border-radius:8px; background:#356b58; color:#ffffff;
    border-color:#356b58; font-weight:600; white-space:nowrap; }
  #new-idea:hover { background:#285441; color:#ffffff; }
  .graph { margin:0 0 12px; border:1px solid #dce2d9; border-radius:16px; overflow:hidden;
    background-color:#ffffff; background-image:radial-gradient(#dce2d9 1px,transparent 1px);
    background-size:24px 24px; box-shadow:0 16px 48px #344b3a0c; }
  .viewport { height:clamp(300px,48vh,560px); border-radius:16px; }
  .graph-tools { top:16px; right:16px; padding:6px; gap:6px; background:#ffffffee;
    border-color:#dce2d9; border-radius:10px; box-shadow:0 4px 16px #344b3a0c; }
  .graph-tools button { width:32px; height:32px; border-color:#dce2d9; border-radius:6px; background:#f0f2ed; }
  .graph-tools button.wide { padding:0 12px; }
  .zoom-level { color:#63746a; padding:0 6px; }
  .graph-hint { color:#63746a; text-align:right; padding:0; margin:0 0 28px; }
  h2 { display:flex; align-items:baseline; gap:14px; border:0; margin:30px 0 16px; font-size:19px; }
  h2 .legend { font-size:12px; font-weight:400; }
  .worklist { padding:13px 18px; background:#ffffff; border-color:#dce2d9; border-radius:10px; }
  .worklist > summary { color:#63746a; }
  .brief-row { margin-bottom:12px; border-color:#dce2d9; border-left-width:3px;
    border-radius:12px; background:#ffffff; transition:background .15s,border-color .15s; }
  .brief-row:hover { background:#f0f2ed; border-color:#ccdacd; }
  .brief { padding:20px; align-items:center; gap:14px; flex-wrap:wrap; }
  .brief .bname { font-size:15px; max-width:100%; overflow-wrap:anywhere; flex-shrink:1; }
  .brief .blurb { min-width:160px; color:#63746a; }
  .brief .enter { color:#356b58; padding:5px 10px; border-radius:6px; background:#e9f0e8; margin-left:auto; }
  .badge { padding:3px 9px; font-size:11px; background:#dce2d9; color:#63746a; margin-left:0; white-space:nowrap; }
  .done > .brief > .badge, .done > h3 > .badge { background:#e1eee4; color:#356548; }
  .doing > .brief > .badge, .doing > h3 > .badge { background:#e2edf2; color:#37617b; }
  .blocked > .brief > .badge, .blocked > h3 > .badge { background:#f5ead9; color:#855a26; }
  .badge.end { background:#eee6f1; color:#765286; }
  .brief-detail { padding:20px 26px; color:#293d36; border-color:#dce2d9; line-height:1.9; }
  .idea { background:#ffffff; padding:26px; border-color:#dce2d9; border-radius:12px; }
  .idea h3 { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:24px; font-size:20px; }
  .iid { margin-left:auto; color:#63746a; font-family:ui-monospace,monospace; }
  dl { grid-template-columns:minmax(110px,160px) minmax(0,1fr); gap:14px 24px; }
  dt { color:#63746a; white-space:normal; font-size:13px; }
  dd { overflow-wrap:anywhere; line-height:1.85; }
  .none, .log, .brief-log, .signoff { color:#63746a; }
  .edit-toggle { padding:5px 10px; border-radius:6px; margin-left:0; }
  .edges { padding-top:12px; }
  .xlink { background:#e9f0e8; border-color:#dce2d9; color:#356b58; padding:3px 9px; }
  :focus-visible { outline:2px solid #356b58; outline-offset:4px; }
  @media (max-width:640px) {
    body { padding:22px 16px 48px; } body::before { margin-bottom:22px; font-size:10px; }
    .brief { padding:16px; gap:10px; } .brief .blurb { flex-basis:100%; order:2; white-space:normal; }
    .brief-detail, .idea { padding:18px; } dl { grid-template-columns:1fr; gap:5px; } dd { margin-bottom:14px; }
    .graph-hint { text-align:left; } .wl-row { flex-wrap:wrap; } .wl-note { white-space:normal; }
    .crumbs { flex-wrap:wrap; } #crumbs { overflow-wrap:anywhere; min-width:0; }
  }
  @media (prefers-reduced-motion:reduce) { .brief-row { transition:none; } .idea.flash, .brief-row.flash { animation:none; } }
  #submit, #submit-panel button { background:#356b58; color:#fff; }
  #sign-panel button { background:#765286; color:#fff; }
  .badge.end { color:#765286; }
</style></head><body>
<h1 id="page-title">${esc(g.project ?? "idea graph")} — 想法图</h1>
<p class="overview">${esc(overview[0] ?? "")}</p>${overview.length > 1 ? `
<details class="overview-more"><summary>项目由来</summary>${
  // Collapsed by default means OMITTING `open` — `open="false"` renders it open.
  // Nothing to fold means no element at all: an expander that opens onto
  // nothing reads as broken.
  overview.slice(1).map((p) => `<p>${esc(p)}</p>`).join("")}</details>` : ""}
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
</p>
<nav class="crumbs"><span id="crumbs"></span><button id="new-idea">＋ 新建想法</button></nav>
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
<p class="graph-hint">滚轮缩放（以光标为中心）· 拖拽平移 · 点击节点定位到本页那一行</p>
<div id="offline-note" hidden>图暂时不可用（离线，画图要联网取一个第三方库）—— 编辑与提交照常。</div>
<div id="pages">
${
  // One section per page, every idea's card exactly once (on its own page).
  // Siblings are in dependency order (topoOrder, I-060/I-061); the JSON model
  // below keeps the written order — the diagram's layout depends on
  // declaration order, and the page re-derives the diagram from the model.
  [page(null), ...g.ideas.map(page)].join("\n")}
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
    if (f === "name") {                            // the row on the parent's page follows the name
      const row = document.querySelector('[data-row="' + id + '"] .bname');
      if (row) row.textContent = value;
    }
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
      out.push({ id: o.tmp, name: nameOf(o.tmp), status: "todo", needs: ledger.needsOf(o.tmp),
        parent: effectiveField(o.tmp, "parent") });
    }
    return { version: DATA.version, endpoints: DATA.endpoints, ideas: out };
  }

  // ── pages ─────────────────────────────────────────────────────────────────
  // One page per idea, addressed by the hash. The page whose id the hash names
  // is shown; every other section stays hidden. The diagram is shared and
  // redrawn with the current page's children — a parent nobody has counts as
  // top level here, the same rule the engine's render used.
  const currentOwner = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    return id && document.getElementById("page-" + id) ? id : "";
  };
  function pageGraph(g) {
    const owner = currentOwner();
    const present = new Set(g.ideas.map((i) => i.id));
    const key = (i) => (i.parent && present.has(i.parent) ? i.parent : "");
    return { version: g.version, endpoints: g.endpoints, ideas: g.ideas.filter((i) => key(i) === owner) };
  }
  function ancestors(id) {
    const out = [];
    const seen = new Set();
    for (let cur = id; cur && !seen.has(cur); cur = effectiveField(cur, "parent")) { seen.add(cur); out.unshift(cur); }
    return out;
  }
  // The one heading and the line under it say what THIS page is about (I-086).
  // One h1 for the whole document, rewritten — not one per section: the header
  // sits above the diagram, and a second h1 would leave every idea page
  // announcing the same title. The tab's text moves with it (WCAG 2.4.2 asks a
  // hash-router view to retitle), read from the same place so the two can't drift.
  // first() is the blurb rule the child rows already use — one expression, not two.
  // (No backticks in here: this script is literal text inside a template string.)
  function showHeader(owner) {
    const first = (s) => String(s ?? "").split("\\n")[0].trim();
    const h1 = document.getElementById("page-title");
    const lead = document.querySelector("p.overview");
    const more = document.querySelector("details.overview-more");
    const project = DATA.project || "idea graph";
    if (h1) h1.textContent = owner ? nameOf(owner) : project + " — 想法图";
    if (lead) lead.textContent = owner ? first(effectiveField(owner, "what")) : first(DATA.overview);
    // The fold holds the project's own history; it belongs to the home page only.
    if (more) more.hidden = !!owner;
    try { document.title = owner ? nameOf(owner) + " — " + project : project + " — 想法图"; }
    catch (e) { /* not every host has a document title to set */ }
  }

  function showPage() {
    const owner = currentOwner();
    for (const p of document.querySelectorAll(".page")) p.hidden = p.id !== "page-" + (owner || "root");
    showHeader(owner);
    const crumbs = document.getElementById("crumbs");
    crumbs.replaceChildren();
    const home = document.createElement("a");
    home.href = "#"; home.textContent = DATA.project || "想法图";
    crumbs.append(home);
    for (const id of ancestors(owner)) {
      crumbs.append(" › ");
      const a = document.createElement("a");
      a.href = "#" + id; a.textContent = nameOf(id);
      if (id === owner) a.className = "here";
      crumbs.append(a);
    }
    // A page with no children has nothing to draw: hide the empty diagram box.
    const empty = pageGraph(snapshot()).ideas.length === 0;
    for (const el of document.querySelectorAll(".graph, .graph-hint")) el.hidden = empty;
    if (!empty && typeof window.redrawGraph === "function") window.redrawGraph(window.currentMermaidSource(), true);
    try { window.scrollTo(0, 0); } catch (e) { /* not every host scrolls */ }
  }
  window.addEventListener("hashchange", showPage);

  // I-117: a diagram node points at a ROW on this page, not at a page. Open it,
  // bring it into view and flash it; the hash — and so the page — stays put.
  // On window because the diagram module (which loads from a CDN and is not run
  // by the tests) only calls it, while the tests call it directly. A row that is
  // not on this page falls back to navigating, which is the old behaviour.
  window.focusRow = (id) => {
    const page = document.getElementById("page-" + (currentOwner() || "root"));
    const row = page && page.querySelector('.children details[data-row="' + id + '"]');
    if (!row) { location.hash = id; return false; }
    row.setAttribute("open", "");
    row.classList.remove("flash");
    void row.offsetWidth;                          // restart the animation on a second click
    row.classList.add("flash");
    try { row.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) { /* not every host scrolls */ }
    return true;
  };

  // The diagram module may never arrive (it loads from a CDN). Empty its source
  // out of the page right now: an undrawn block shows the raw flowchart text as
  // body copy, which is worse than showing nothing at all.
  const pre = document.querySelector("pre.mermaid");
  if (pre) pre.textContent = "";
  const offline = document.getElementById("offline-note");

  window.currentMermaidSource = () => buildMermaidSource(pageGraph(snapshot()));
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
    // D27: the page asks; the signature itself lands when the person answers the
    // one-time challenge in the agent's chat. Say so, or the button lies.
    head.textContent = "给 " + id + " 的人工验证提签字请求（提交后回一句一次性口令才真的签上）。你要签的是这件事：";
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
    // D14 + D34: the engine a project actually has is the single-file bundle at
    // the host-neutral plugin root, so that is the one command this page names —
    // interpolated from ENGINE_CMD, not retyped, because a hand-copied path that
    // merely happens to match today is exactly what D14 forbids.
    how.textContent = "把它放进 " + (PROJECT || "<项目目录>") + "/ideas/ ，然后跑："
      + " ${ENGINE_CMD} apply";
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
      // I-103: the server already sends the sign-off challenges back with the
      // response; show them here instead of only on the terminal running serve.
      if (done.signs && done.signs.length) {
        const pre = document.createElement("pre");
        pre.className = "pending-text";
        pre.textContent = done.signs.join("\\n");
        say("签字请求已发出 —— 下面这段只能由人在对话里亲手回：").append(pre);
      }
      if (done.git) say("git：" + done.git);
      const again = document.createElement("button");
      again.textContent = "刷新页面";
      again.addEventListener("click", () => { try { location.reload(); } catch (e) {} });
      panel.append(again);
    });
    box.append(list, go);
  }

  if (submitBtn) submitBtn.addEventListener("click", () => { submitChanges(); });

  document.getElementById("new-idea").addEventListener("click", () => {
    // Born under the page it was made on: parent is the current page's idea.
    const owner = currentOwner();
    const tmp = ledger.addIdea({ name: "", what: "", why: "", expected: "", parent: owner });
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
    const parentBox = el.querySelector('[data-field="parent"]');
    if (parentBox) parentBox.value = owner;
    // Its own page, and a row on the page it was made from — then go there.
    const sec = document.createElement("section");
    sec.className = "page"; sec.id = "page-" + tmp; sec.hidden = true;
    sec.append(el);
    document.getElementById("pages").append(sec);
    const list = document.querySelector("#page-" + (owner || "root") + " .children");
    if (list) {
      // I-117: the same collapsible the renderer writes — a summary plus a
      // read-only body. The body stays a one-line note until the eight answers
      // are written and submitted; the page re-renders from the file after a
      // write-back anyway.
      const row = document.createElement("details");
      row.className = "brief-row todo"; row.setAttribute("data-row", tmp);
      const summary = document.createElement("summary");
      summary.className = "brief";
      const bname = document.createElement("span");
      bname.className = "bname"; bname.textContent = "（新想法）";
      const enter = document.createElement("a");
      enter.className = "enter"; enter.href = "#" + tmp; enter.setAttribute("data-brief", tmp); enter.textContent = "进入 →";
      summary.append(bname, enter);
      const detail = document.createElement("div");
      detail.className = "brief-detail"; detail.textContent = "八问还没填 —— 点「进入」到它自己那一页去写。";
      row.append(summary, detail);
      list.append(row);
    }
    markIncomplete(tmp);
    afterStructure(tmp);
    location.hash = tmp;
  });

  refresh();
  showPage();
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
    startOnLoad: false, securityLevel: "loose", theme: "base", themeVariables: { background: "#ffffff", primaryColor: "#e9f0e8", primaryTextColor: "#293d36", lineColor: "#8b9e92", edgeLabelBackground: "#f7f6f2" }, layout,
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

  // I-117: a node is a ROW on this page. focusRow lives in the editing module
  // (so the tests can reach it) and falls back to navigating when the row is
  // not on this page. Every in-page link stays a plain href="#id".
  window.nodeClick = (id) => { if (typeof window.focusRow === "function") window.focusRow(id); else location.hash = id; };

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
  // refit is for a page change: a new subgraph under the old pan would sit
  // off-screen, whereas an edit on the same page must keep the human's view.
  window.redrawGraph = (src, refit) => { draw(src).then(() => (refit ? fit() : apply())); };
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
  /** I-139: whether POST /approve is open, i.e. AIDEV_APPROVE_SECRET was set. */
  approveOpen: boolean;
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

/** One git command in the project, stdout back, stderr in the thrown error
 *  (I-137). execFileSync, not a library: three commands do not earn a
 *  dependency in the single-file bundle (D28). */
export function gitRun(projectDir: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: projectDir, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const e = error as { stderr?: string; stdout?: string; message?: string };
    throw new Error(`git ${args.join(" ")} 失败：${(e.stderr || e.stdout || e.message || "").trim()}`);
  }
}

export async function serve(
  projectDir: string, file: string,
  opts: { port?: number; open?: boolean; gitSync?: boolean } = {},
): Promise<Serving> {
  const token = randomBytes(16).toString("hex");
  // I-139: read once at start; never printed, never rendered.
  const approveSecret = env.AIDEV_APPROVE_SECRET ?? "";
  let approveSeq = 0;
  // I-137: with the switch on, the page is always rendered from what the
  // remote has, and every write leaves as a commit. Failures are shown, never
  // swallowed; the file on disk is never rolled back.
  const pull = () => { if (opts.gitSync) gitRun(projectDir, ["pull", "--ff-only", "--quiet"]); };
  const commitAndPush = (message: string): string | undefined => {
    if (!opts.gitSync) return undefined;
    try {
      const tracked = ["ideas/graph.yaml", "ideas/log.md", "ideas/approvals"]
        .filter((rel) => existsSync(join(projectDir, rel)));
      gitRun(projectDir, ["add", "--", ...tracked]);
      gitRun(projectDir, ["commit", "--quiet", "-m", message]);
      gitRun(projectDir, ["push", "--quiet"]);
      return undefined;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      try { appendFileSync(logFile(projectDir), `- ${new Date().toISOString().replace("T", " ").slice(0, 16)}  serve 提交失败：${reason}\n`); } catch { /* logging never fails a save */ }
      return reason;
    }
  };
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
        try { pull(); } catch (error) {
          res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
          res.end(`拉取失败，页面没有渲染 —— 先把仓库理顺再刷新。\n\n${error instanceof Error ? error.message : String(error)}\n`);
          return;
        }
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
        // The project dir goes with it: a status op from the page is gated the
        // same way `set` is (D17/D20), not more loosely for coming over HTTP.
        const result = applyChanges(source, body.envelope, today, projectDir);
        if (!result.ok) { send(res, 200, { ok: false, reason: result.reason }); return; }

        // Two steps on one route: first tell the person exactly what would
        // happen, and only write once they have said yes.
        if (body.confirm !== true) { send(res, 200, { ok: true, preview: true, changed: result.changed }); return; }

        atomicWrite(file, result.text!);
        appendServeLog(projectDir, result.changed ?? []);
        const graph = parseDocument(result.text!).toJSON() as Graph;
        // D27: the page cannot sign. It asks, and the person answers the
        // one-time challenge in the agent's chat — printed here, where they are.
        const signs = requestSignatures(projectDir, graph, result.signRequests ?? [], today);
        for (const line of signs) console.log(line);
        const git = commitAndPush(`网页写回 ${result.changed?.length ?? 0} 处（serve）`);
        send(res, 200, { ok: true, changed: result.changed, graph, signs, ...(git ? { git } : {}) });
        return;
      }

      // I-139 / D36: the out-of-band exception. A host with its own login
      // forwards the person's literal reply together with a credential it was
      // handed in the environment. The credential never reaches the page, the
      // log, or stdout; without it (or with a wrong one) nothing is consumed.
      // The reply itself goes through applyApproval — the same regex, drift
      // check and one-time file as the chat path; nothing is relaxed here.
      if (req.method === "POST" && path === "/approve") {
        if (!approveSecret) { send(res, 404, { ok: false, reason: "没有这个地址" }); return; }
        const body = (await readJson(req)) as { secret?: string; words?: string } | null;
        const given = Buffer.from(String(body?.secret ?? ""));
        const want = Buffer.from(approveSecret);
        if (given.length !== want.length || !timingSafeEqual(given, want)) {
          send(res, 403, { ok: false, reason: "凭证不对 —— 这个入口只认起服务的那个宿主" });
          return;
        }
        approveSeq += 1;
        const today = new Date().toISOString().slice(0, 10);
        const outcome = applyApproval(projectDir, String(body?.words ?? ""), {
          date: today, session_id: "serve", turn_id: `approve-${approveSeq}`,
        });
        if (!outcome) {
          send(res, 200, { ok: false, reason: "这不是一句口令回复 —— 整条消息只能是「批准 CC-XXXXXXXX」或「拒绝 CC-XXXXXXXX」" });
          return;
        }
        const git = outcome.ok ? commitAndPush(`${outcome.decision === "approved" ? "批准" : "拒绝"}回执（serve · ${outcome.gate}）`) : undefined;
        send(res, 200, { ...outcome, ...(git ? { git } : {}) });
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
    host: HOST, port, token, url, approveOpen: approveSecret !== "",
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

// No `agent:` key: the graph belongs to the project (D10). A legacy graph that
// still carries one is a migration input, not something this engine seeds.
const SEED = `version: 1
project: PROJECT_NAME
overview: >
  一段话说清这个项目在做什么。

# 终点：什么叫"这个项目做完了"。每个都是下面某个想法的 id。
endpoints: []

ideas: []
`;

/** `serve` keeps the process alive; every other command exits when it returns. */
const KEEP_RUNNING = -1;

/**
 * Every subcommand this CLI answers, with the arguments each takes (D28). The
 * usage text is generated from this list and from nowhere else — the string it
 * replaces was hand-kept and had already drifted, silently omitting `migrate`,
 * `run-check` and `request-approval` from a message whose entire job is to say
 * what exists.
 */
export const SUBCOMMANDS: [name: string, args: string][] = [
  ["coord", "join|say|inbox|ack|status|recover [选项]"],
  ["paths", ""],
  ["init", ""],
  ["migrate", "[--pick claude|cursor|codex] [--dry-run]"],
  ["scan", "[--reset] [--n 40] [--skipped]"],
  ["new", "<名称> [--needs I-001,I-002]"],
  ["check", ""],
  ["status", ""],
  ["next", ""],
  ["show", "<id>"],
  ["log", "[id] [--n 10]"],
  ["set", "<id> <status>"],
  ["allow", "<path>"],
  ["render", ""],
  ["apply", "[file]"],
  ["serve", "[--port 4173] [--no-open] [--git-sync]"],
  ["request-approval", "--node I-002 [I-003 …] [--gate plan|red-waiver|manual-check] [--by 人名]"],
  ["run-check", "<id> --phase red|green [--timeout 秒]"],
];

/** One command's own usage line, off the same list — never retyped (D28). */
const usageOf = (name: string) => {
  const found = SUBCOMMANDS.find(([n]) => n === name);
  return `usage: ${ENGINE_CMD} ${name}${found?.[1] ? ` ${found[1]}` : ""}`;
};

/** The usage text, generated from the list above. */
export const usageLines = (): string[] => [
  `usage: ${ENGINE_CMD} <子命令>`,
  ...SUBCOMMANDS.map(([name, args]) => `  ${name}${args ? ` ${args}` : ""}`),
  "  共用参数：[--file ideas/graph.yaml] [--project .] [--by who] [--note text] [--date YYYY-MM-DD]",
];

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Regenerate the page from what is on disk right now. */
function redraw(file: string, projectDir: string): string {
  const out = file.replace(/\.ya?ml$/, ".html");
  const text = readFileSync(file, "utf8");
  const graph = parseDocument(text).toJSON() as Graph;
  atomicWrite(out, render(graph, text, projectDir));
  return `wrote ${out} (${graph.ideas.length} ideas)`;
}

// Exported for the single-file bundle's entry (I-096); returns KEEP_RUNNING
// (-1) when `serve` should keep the process alive.
export function main(args: string[]): number {
  const command = args[0];
  const projectDir = resolve(flag(args, "project") ?? cwd());
  const file = resolve(flag(args, "file") ?? graphPath(projectDir));
  // Callers pass the date in so the tool has no clock of its own to disagree with.
  const today = flag(args, "date") ?? new Date().toISOString().slice(0, 10);

  // Commands that may be pointed at any graph: they only read the file --file
  // names. Everything else writes state that is keyed to the project's own
  // graph — approval receipts, red/green evidence, the guard's verdict all
  // resolve through paths(projectDir), never through --file (D10: the project
  // owns exactly one graph). Letting a writing command follow --file elsewhere
  // is what mints a challenge against one file that is answered against
  // another, so refuse it here instead of half-honouring the flag.
  const READS_ANY_GRAPH = ["check", "next", "show", "log", "status", "render", "allow", "paths", "scan"];
  if (!READS_ANY_GRAPH.includes(command) && !sameFile(file, graphPath(projectDir))) {
    const rel = (p: string) => relative(projectDir, p).replaceAll("\\", "/") || p;
    console.error(`\`${command}\` 会改状态，只能作用在项目自己的图上：${rel(graphPath(projectDir))} —— 项目的图只有一份（D10）。`);
    console.error(`--file ${rel(file)} 是另一份图；批准口令和红绿证据都记在项目图名下，写到别处会造出永远答不上的口令。`);
    console.error(`去掉 --file 重跑。只想看那份旧图：${READS_ANY_GRAPH.join(" / ")} 加 --file 照常可用；要把它的内容并进来：migrate。`);
    return 2;
  }

  if (command === "coord") {
    return coordMain(paths(projectDir).runtime, args.slice(1));
  }

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
    // Every run, not just the first: files appear and disappear while a scan is
    // being worked through, and a checklist built once describes a project that
    // no longer exists (D29). Left alone, the whole `companion/` directory can
    // arrive after the list was written and be counted as read by nobody.
    const { added, removed } = reconcileWorklist(projectDir, all);
    if (added.length > 0 || removed.length > 0) {
      console.log(`清单已对账：新出现 ${added.length} 个（未读），消失 ${removed.length} 个`);
      for (const f of added.slice(0, 20)) console.log(`  + ${f}`);
      if (added.length > 20) console.log(`  … 另有 ${added.length - 20} 个新文件`);
    }
    // D29: what never made it onto the list, and why. Counted every run and
    // listed on demand — a skipped file the report cannot name is "not read"
    // wearing "not there" as a costume.
    const skipped = skippedFiles(projectDir);
    if (skipped.length > 0) {
      console.log(`跳过 ${skipped.length} 个文件${args.includes("--skipped") ? "：" : "（--skipped 逐条列出，各带原因）"}`);
      if (args.includes("--skipped")) for (const s of skipped) console.log(`  - ${s.file}\t${s.reason}`);
    }
    const left = readWorklist(projectDir);
    // Counted off the struck records, not `all.length - left.length` (D12):
    // subtraction turns "never was on the list" into "already read", which is
    // exactly the self-report R7 exists to make impossible.
    const total = readChecklist(projectDir).length;
    const done = worklistDone(projectDir);
    console.log(`已读 ${done}/${total}${left.length === 0 ? "  —  全部读完" : `，还剩 ${left.length}：`}`);
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
    atomicWrite(file, SEED.replace("PROJECT_NAME", projectDir.split(/[\\/]/).pop() ?? "project"));
    console.log(`created ${file}`);
    return 0;
  }

  // `migrate` runs before a plain graph exists — that is its whole point.
  if (command === "migrate") {
    const result = migrate(projectDir, {
      pick: flag(args, "pick") as LegacyKind | undefined,
      dryRun: args.includes("--dry-run"),
      date: today,
    });
    for (const line of result.report ?? []) console.log(line);
    if (!result.ok) { console.error(result.reason); return 1; }
    if (result.written) console.log(`\n写出 ${relative(projectDir, result.written)}；报告在 ideas/migrate-report.md`);
    return 0;
  }

  // `paths` answers "where does everything live" — before a graph exists, too.
  if (command === "paths") {
    for (const [name, value] of Object.entries(paths(projectDir))) {
      console.log(`${name}\t${relative(projectDir, value).replaceAll("\\", "/")}`);
    }
    return 0;
  }

  const { doc, graph } = load(file);

  switch (command) {
    case "check": {
      const { errors, warnings } = check(graph, projectDir, file);
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
      // D11: the wording comes from QUESTIONS, the same list the card renders
      // from — this used to be a third hand-typed copy of the eight questions.
      // The layout itself now lives in `questionLines`, shared with the approval
      // prompt so the two can never drift apart (I-102); question 7 gained the
      // three fields this branch used to drop on the floor.
      for (const block of questionLines(idea)) console.log(`\n${block}`);
      console.log(`\n前置想法  ${(idea.needs ?? []).map((n) => `${n} (${map.get(n)?.status ?? "?"})`).join(", ") || "—"}`);
      console.log(`它是谁的前置  ${dependents(graph, idea.id).join(", ") || "—"}`);
      for (const l of idea.log ?? []) console.log(`  log ${l.date} ${l.by ?? ""} ${l.note}`);
      return 0;
    }
    case "log": {
      // D28: the per-idea append-only record, read out loud. Without this the
      // only way to see why an idea moved is to open the yaml and scroll to it.
      const wanted = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
      if (wanted && !byId(graph).has(wanted)) { console.error(`no idea with id ${wanted}`); return 1; }
      const wall = wanted ? [byId(graph).get(wanted)!] : graph.ideas;
      // `--n` keeps the tail: the last few entries are the ones being asked about.
      const tail = Number(flag(args, "n")) || 0;
      let printed = 0;
      for (const idea of wall) {
        const entries = idea.log ?? [];
        if (entries.length === 0) continue;
        console.log(`${idea.id}\t${idea.name}\t[${idea.status ?? "todo"}]`);
        for (const l of tail > 0 ? entries.slice(-tail) : entries) {
          console.log(`  ${l.date}\t${l.by ?? "—"}\t${l.note}`);
          printed += 1;
        }
      }
      if (printed === 0) console.log(wanted ? `${wanted} 还没有任何修改记录` : "这张图里还没有任何修改记录");
      return 0;
    }
    case "set": {
      setStatus(doc, graph, args[1], args[2] as Status,
        { by: flag(args, "by"), note: flag(args, "note"), date: today }, projectDir);
      save(file, doc);
      // Re-render here too, so the page on disk is never a stale copy of a
      // graph somebody already changed.
      redraw(file, projectDir);
      console.log(`${args[1]} → ${args[2]}`);
      return 0;
    }
    case "new": {
      const name = args[1];
      if (!name || name.startsWith("--")) { console.error(usageOf("new")); return 2; }
      const needs = (flag(args, "needs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const id = addIdea(doc, graph, name, needs, today);
      save(file, doc);
      redraw(file, projectDir);
      console.log(id);
      return 0;
    }
    case "allow": {
      if (!args[1]) { console.error(usageOf("allow")); return 2; }
      // The guard's verdict, verbatim — same function, same answer (I-099).
      const verdict = decideProductWrite(projectDir, graph, args[1]);
      console.log(`${verdict.allow ? "allow" : "deny"}\t${args[1]}\t${verdict.reason}`);
      return verdict.allow ? 0 : 1;
    }
    case "run-check": {
      const id = args[1];
      const phase = flag(args, "phase") as "red" | "green" | undefined;
      if (!id || !phase || !["red", "green"].includes(phase)) {
        console.error(usageOf("run-check"));
        return 2;
      }
      const record = runCheck(projectDir, graph, id, phase,
        { timeoutMs: (Number(flag(args, "timeout")) || 120) * 1000 });
      console.log(`${phase} → 退出码 ${record.exit_code}${record.outcome ? ` (${record.outcome})` : ""}`);
      // D8/H5: 命令没跑起来时别让人以为记下了一次红。
      if (record.outcome === "infra_error") {
        console.log(`验证命令没能真正跑起来：${record.infra_error} —— 这不是测试红了，实现的门不开。`);
        console.log(record.output_tail);
        return 1;
      }
      if (phase === "red" && record.outcome !== "unexpected_pass") {
        const gate = redGateReady(projectDir, graph, id);
        if (!gate.ready) console.log(`注意：${gate.reason}`);
      }
      if (record.outcome === "unexpected_pass") {
        console.log(`测试还没实现就通过了 —— 这挡住实现写入。要么测试写错了，要么真有现成实现：`);
        console.log(`  request-approval --gate red-waiver --node ${id}   # 请人裁决`);
      }
      if (phase === "green" && record.exit_code !== 0) {
        console.log(record.output_tail);
        return 1;
      }
      return 0;
    }
    case "request-approval": {
      const gate = (flag(args, "gate") ?? "plan") as Gate;
      // `--node I-101 I-102` or `--node I-101,I-102`: every id up to the next flag.
      const at = args.indexOf("--node");
      const nodes = at < 0 ? [] : args.slice(at + 1).join(",").split(/[,\s]+/)
        .reduce<string[]>((acc, s) => { if (s.startsWith("--")) acc.push("--"); else if (s && !acc.includes("--")) acc.push(s); return acc; }, [])
        .filter((s) => s !== "--");
      if (!["plan", "red-waiver", "manual-check"].includes(gate) || nodes.length === 0) {
        console.error(usageOf("request-approval"));
        return 2;
      }
      const r = requestApproval(projectDir, graph, gate, nodes, { by: flag(args, "by"), date: today });
      // The content FIRST, the token after it (I-102). Until this landed the
      // command printed three lines and not one word of what was being
      // approved — so "请人看过内容后" pointed at nothing, and the gate came
      // down to trusting whatever the agent chose to retell.
      console.log(approvalLines(approvalProjection(graph, nodes)).join("\n"));
      console.log(`一次性口令：${r.challenge}（${gate} · ${nodes.join(", ")}）`);
      console.log(`请人看过上面的内容后，整条消息回复：批准 ${r.challenge}`);
      console.log(`（拒绝就回：拒绝 ${r.challenge}。内容改动或口令用过一次即作废。）`);
      console.log(`这一句只能由人在对话里亲手回，别处点什么都不算数。`);
      return 0;
    }
    case "status": {
      // 一览每个想法卡在哪。todo 的说清还差什么；能动手的标 READY。
      for (const idea of graph.ideas) {
        const st = idea.status ?? "todo";
        let note = "";
        if (st === "todo") {
          note = isBuildReady(idea) ?? needsUnmet(idea, graph) ?? "READY";
        } else if (st === "doing") {
          note = `writing: ${claimedFiles(idea).join(", ") || "—"}`;
        }
        console.log(`${idea.id}\t[${st}]\t${idea.name}${note ? `\t${note}` : ""}`);
      }
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
        gitSync: args.includes("--git-sync"),
      }).then((live) => {
        console.log(`想法图开在 ${live.url}`);
        if (live.approveOpen) console.log(`批准入口已开（POST /approve，凭证来自环境变量，不打印）。`);
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

      // D17/D20: same gates as `set` — the approvals and the evidence are read
      // from the project dir, so the write-back has to be told where it is.
      const result = applyChanges(readFileSync(file, "utf8"), envelope, today, projectDir);
      if (!result.ok) {
        // Refused means refused: the change file stays exactly where it is, so
        // the person's edits are not the thing that gets destroyed.
        console.error(`拒绝写回：${result.reason}\n\n改动文件原样留在 ${changeFile}，没有动过。`);
        return 1;
      }
      atomicWrite(file, result.text!);
      for (const line of result.changed ?? []) console.log(`  ${line}`);
      console.log(`\n写回 ${result.changed?.length ?? 0} 处改动 → ${relative(projectDir, file)}`);
      // The signatures the envelope asked for become challenges, never writes (D27).
      const written = parseDocument(result.text!).toJSON() as Graph;
      for (const line of requestSignatures(projectDir, written, result.signRequests ?? [], today)) {
        console.log(`\n${line}`);
      }
      const archived = changeFile.replace(/\.json$/, "") + `.applied-${today}.json`;
      try { renameSync(changeFile, archived); console.log(`改动文件已归档 → ${relative(projectDir, archived)}`); }
      catch { console.log(`（改动文件归档失败，它还在 ${changeFile}）`); }
      console.log(redraw(file, projectDir));
      console.log(`\n回浏览器刷新一下页面，再做下一轮。`);
      return 0;
    }
    default:
      for (const line of usageLines()) console.error(line);
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
