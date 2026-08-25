#!/usr/bin/env tsx
// The idea-graph engine. One file, one graph, six commands.
// Format spec: ./FORMAT.md
//
//   npx tsx ideas.ts check | next | show <id> | set <id> <status> | render | init
//
// ponytail: no package, no build step, no server. tsx runs it from source so a
// target repo needs nothing installed but this folder's `yaml` dependency.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { argv, exit, cwd } from "node:process";
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

/** Write back through the parsed Document so comments and formatting survive. */
function save(file: string, doc: Document): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, String(doc));
  renameSync(tmp, file);   // atomic: a crash mid-write leaves the old graph intact
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

export function readWorklist(projectDir: string): string[] {
  const file = worklistFile(projectDir);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
}

export function writeWorklist(projectDir: string, files: string[]): void {
  mkdirSync(dirname(worklistFile(projectDir)), { recursive: true });
  writeFileSync(worklistFile(projectDir), files.join("\n") + (files.length > 0 ? "\n" : ""));
}

/**
 * Cross one file off. Returns true when it was on the list — the caller uses
 * that to decide whether the read was worth mentioning.
 * ponytail: a partial Read (offset/limit) still counts. Tracking byte ranges
 * costs more than it catches; revisit if agents start gaming it.
 */
export function strike(projectDir: string, filePath: string): boolean {
  const list = readWorklist(projectDir);
  if (list.length === 0) return false;
  const target = relative(projectDir, resolve(filePath)).replaceAll("\\", "/");
  const key = target.toLowerCase();
  const kept = list.filter((f) => f.toLowerCase() !== key);
  if (kept.length === list.length) return false;
  writeWorklist(projectDir, kept);
  return true;
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

// ─── render ─────────────────────────────────────────────────────────────────

const esc = (s: unknown = "") =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const NONE = "<span class='none'>—</span>";

export function render(g: Graph): string {
  const map = byId(g);
  const ends = new Set(g.endpoints ?? []);
  const mid = (id: string) => "n_" + id.replace(/[^A-Za-z0-9]/g, "_");
  const cls = (i: Idea) => (ends.has(i.id) ? "endpoint" : i.status ?? "todo");

  // The graph itself shows names only — detail lives one click away.
  const mermaid = [
    "flowchart TD",
    "classDef done fill:#14532d,stroke:#86efac,color:#f0fdf4;",
    "classDef doing fill:#1e3a8a,stroke:#93c5fd,color:#eff6ff;",
    "classDef todo fill:#334155,stroke:#94a3b8,color:#f1f5f9,stroke-dasharray:5 3;",
    "classDef blocked fill:#7c2d12,stroke:#fdba74,color:#fff7ed,stroke-dasharray:2 2;",
    "classDef endpoint fill:#581c87,stroke:#d8b4fe,color:#faf5ff,stroke-width:3px;",
  ];
  for (const i of g.ideas) mermaid.push(`${mid(i.id)}["${(i.name || i.id).replace(/["()<>]/g, "")}"]`);
  for (const i of g.ideas) {
    for (const need of i.needs ?? []) if (map.has(need)) mermaid.push(`${mid(need)} --> ${mid(i.id)}`);
  }
  const buckets: Record<string, string[]> = {};
  for (const i of g.ideas) (buckets[cls(i)] ??= []).push(mid(i.id));
  for (const [c, ids] of Object.entries(buckets)) mermaid.push(`class ${ids.join(",")} ${c};`);
  for (const i of g.ideas) mermaid.push(`click ${mid(i.id)} call nodeClick("${i.id}")`);

  const links = (ids: string[]) => ids.length === 0 ? NONE : ids.map((id) =>
    `<a class="xlink" href="#${esc(id)}" data-goto="${esc(id)}">${esc(map.get(id)?.name ?? id)}</a>`).join(" ");

  const codeOf = (i: Idea) => !i.code?.length ? "<span class='none'>尚未实现</span>"
    : i.code.map((c) => `<code>${esc(c.file)}${c.lines ? ":" + esc(c.lines) : ""}</code>${c.symbol ? ` · ${esc(c.symbol)}` : ""}`).join("<br>");

  const verifyOf = (i: Idea) => {
    const v = i.verify;
    if (!v) return NONE;
    if (v.command) return `<code>${esc(v.command)}</code>${v.pass ? ` → ${esc(v.pass)}` : ""}`;
    return `${esc(v.manual)}<br><span class="signoff">人工签字：${v.signed_off ? esc(v.signed_off) : "未签"}</span>`;
  };

  const STATUS_ZH: Record<string, string> = { todo: "待办", doing: "进行中", done: "已完成", blocked: "受阻" };
  const counts = STATUSES.map((s) => `${STATUS_ZH[s]} ${g.ideas.filter((i) => (i.status ?? "todo") === s).length}`).join(" · ");

  const card = (i: Idea) => `<section class="idea ${cls(i)}" id="${esc(i.id)}">
  <h3>${esc(i.name)} <span class="badge">${esc(STATUS_ZH[i.status ?? "todo"])}</span>${ends.has(i.id) ? '<span class="badge end">终点</span>' : ""}<span class="iid">${esc(i.id)}</span></h3>
  <dl>
    <dt>是什么</dt><dd>${esc(i.what) || NONE}</dd>
    <dt>为什么有这个想法</dt><dd>${esc(i.why) || NONE}</dd>
    <dt>预期结果</dt><dd>${esc(i.expected) || NONE}</dd>
    <dt>如何实现</dt><dd>${esc(i.how) || NONE}</dd>
    <dt>为什么这样实现</dt><dd>${esc(i.why_this_way) || NONE}</dd>
    <dt>代码在哪</dt><dd>${codeOf(i)}</dd>
    <dt>如何验证</dt><dd>${verifyOf(i)}</dd>
    <dt>未来怎么用</dt><dd>${esc(i.future) || NONE}</dd>
  </dl>
  <p class="edges"><b>前置想法</b> ${links((i.needs ?? []).filter((n) => map.has(n)))}</p>
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
  .overview { color:#93a1b0; margin:0 0 18px; max-width:70ch; }
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
</style></head><body>
<h1>${esc(g.project ?? "idea graph")} — 想法图</h1>
<p class="overview">${esc(g.overview)}</p>
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
  <div class="viewport"><div class="canvas"><pre class="mermaid">${mermaid.join("\n")}</pre></div></div>
</div>
<p class="graph-hint">滚轮缩放（以光标为中心）· 拖拽平移 · 点击节点看详情</p>
<h2>想法详情</h2>
${g.ideas.map(card).join("\n")}
<script type="module">
  import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
  mermaid.initialize({ startOnLoad: false, securityLevel: "loose", theme: "dark" });

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
    viewport.setPointerCapture(e.pointerId);
    viewport.classList.add("dragging");
  });
  viewport.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
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

  // Render first, then fit — the diagram has no size until mermaid has drawn it.
  await mermaid.run({ nodes: document.querySelectorAll(".mermaid") });
  fit();
  new ResizeObserver(() => { if (k === 1 && tx === 0 && ty === 0) fit(); }).observe(viewport);
</script></body></html>`;
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

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
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
      writeWorklist(projectDir, all);
      console.log(`worklist: ${all.length} 个文件待读 → ${relative(projectDir, worklistFile(projectDir))}`);
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
      console.log(`${args[1]} → ${args[2]}`);
      return 0;
    }
    case "render": {
      const out = file.replace(/\.ya?ml$/, ".html");
      writeFileSync(out, render(graph));
      console.log(`wrote ${out} (${graph.ideas.length} ideas)`);
      return 0;
    }
    default:
      console.error("usage: ideas.ts check | next | show <id> | set <id> <status> | render | init | scan");
      console.error(`       [--file ideas/${agentName(cwd(), "graph.yaml")}] [--project .] [--by who] [--note text]`);
      return 2;
  }
}

if (argv[1]?.endsWith("ideas.ts")) {
  try {
    exit(main(argv.slice(2)));
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    exit(1);
  }
}
