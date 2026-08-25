#!/usr/bin/env tsx
// Idea-graph engine. Format: ./FORMAT.md
//
//   npx tsx ideas.ts check | next | show <id> | new <name> | set <id> <status>
//                        | log | render | init
//
// ponytail: no build step, no server. tsx runs it from source. The only runtime
// dependency is `yaml`, so comments in graph.yaml survive a round-trip.

import { spawnSync } from "node:child_process";
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, renameSync,
  unlinkSync, writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { argv, cwd, exit } from "node:process";
import { fileURLToPath } from "node:url";
import { parseDocument, type Document } from "yaml";
import {
  AGENT, decideWrite, fileClash, isBuildReady, ledgerNames, needsUnmet,
} from "./gate-lib.mjs";

export {
  AGENT, agentName, decideWrite, fileClash, graphPath, isBuildReady, ledgerNames, logPath,
  nameIsTaken, needsUnmet, unlockedFiles,
} from "./gate-lib.mjs";

export type Status = "todo" | "doing" | "done" | "blocked";
const STATUSES: Status[] = ["todo", "doing", "done", "blocked"];

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
  /** Which companion owns this file: cursor | claude | codex. */
  agent?: string;
  endpoints?: string[];
  /** Default true. `false` disables the write-gate. */
  enforce?: boolean;
  /** Repo-relative prefixes (`cursor-companion/**`) the gate will not block. */
  exempt?: string[];
  ideas: Idea[];
}

export interface ProjectLogEntry {
  date: string;
  by?: string;
  ideas?: string[];
  files?: string[];
  note: string;
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
export function save(file: string, doc: Document): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, String(doc));
  try {
    renameSync(tmp, file);
  } catch {
    writeFileSync(file, readFileSync(tmp));
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
}

// ─── graph queries ──────────────────────────────────────────────────────────

export const byId = (g: Graph) => new Map(g.ideas.map((i) => [i.id, i]));

/** Who lists `id` in their `needs` — the "这个想法是哪些想法的前置" direction. */
export function dependents(g: Graph, id: string): string[] {
  return g.ideas.filter((i) => (i.needs ?? []).includes(id)).map((i) => i.id).sort();
}

/** todo ideas whose prerequisites are all done — the next-actions list. */
export function frontier(g: Graph): Idea[] {
  const map = byId(g);
  return g.ideas.filter((i) =>
    (i.status ?? "todo") === "todo" &&
    (i.needs ?? []).every((n) => map.get(n)?.status === "done"));
}

/** First cycle found, as the id path that closes it. Empty when acyclic. */
export function findCycle(g: Graph): string[] {
  const map = byId(g);
  const state = new Map<string, 0 | 1 | 2>();
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

export function nextId(g: Graph): string {
  let max = 0;
  for (const i of g.ideas) {
    const m = /^I-(\d+)$/.exec(i.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `I-${String(max + 1).padStart(3, "0")}`;
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
      if (!existsSync(resolve(projectDir, ref.file))) {
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

  return { errors, warnings };
}

// ─── mutate ─────────────────────────────────────────────────────────────────

export function runVerifyCommand(
  command: string, projectDir: string, timeoutMs = 120_000,
): { passed: boolean; output: string; error?: string } {
  const parts = command.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { passed: false, output: "", error: "empty verify.command" };
  const [cmd, ...args] = parts;
  const spawn = (shell: boolean) =>
    spawnSync(cmd, args, { cwd: projectDir, encoding: "utf8", timeout: timeoutMs, shell, windowsHide: true });

  let r = spawn(false);
  if (process.platform === "win32" && r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") {
    r = spawn(true);
  }
  if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") {
    return { passed: false, output: "", error: `command not found: ${cmd}` };
  }
  if (r.error && /ETIMEOUT|ETIMEDOUT/i.test(String(r.error.message))) {
    return { passed: false, output: "", error: `timeout after ${timeoutMs}ms` };
  }
  const output = `${r.stdout ?? ""}${r.stderr ? "\n" + r.stderr : ""}`;
  if (r.status === 0) return { passed: true, output };
  return { passed: false, output, error: r.signal ? `killed ${r.signal}` : `exit ${r.status}` };
}

export function setStatus(
  doc: Document, graph: Graph, id: string, status: Status,
  entry: { by?: string; note?: string; date: string },
  opts: { runVerify?: boolean; force?: boolean; projectDir?: string } = {},
): void {
  const index = graph.ideas.findIndex((i) => i.id === id);
  if (index < 0) throw new Error(`no idea with id ${id}`);
  if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join(" | ")}`);

  const idea = graph.ideas[index];

  if (status === "doing") {
    const ready = isBuildReady(idea);
    if (ready) throw new Error(`${id}: cannot be doing — ${ready}. /idea-discuss first.`);
    const unmet = needsUnmet(idea, graph);
    if (unmet.length) throw new Error(`${id}: needs not done — ${unmet.join(", ")}`);
    const clash = fileClash(idea, graph);
    if (clash.length) throw new Error(`${id}: overlapping doing files — ${clash.join(", ")}`);
  }

  if (status === "done") {
    if (!idea.code?.length) throw new Error(`${id}: cannot be done without \`code\` — say where it lives`);
    if (!idea.verify) throw new Error(`${id}: cannot be done without \`verify\``);
    if (idea.verify.manual && !idea.verify.signed_off) {
      throw new Error(`${id}: manual check — a human must fill \`verify.signed_off\` before done`);
    }
    if (idea.verify.command && opts.runVerify && !opts.force) {
      const result = runVerifyCommand(idea.verify.command, opts.projectDir ?? cwd());
      if (!result.passed) {
        throw new Error(`${id}: verify failed (${result.error ?? "exit non-zero"}). Fix it or /idea-debug. Output:\n${result.output}`);
      }
    }
  }

  const note = opts.force && status === "done"
    ? `${entry.note || "status → done"} — FORCED without running verify`
    : entry.note || `status → ${status}`;

  doc.setIn(["ideas", index, "status"], status);
  const log = (idea.log ?? []).concat({
    date: entry.date,
    ...(entry.by ? { by: entry.by } : {}),
    note,
  });
  doc.setIn(["ideas", index, "log"], log);
}

export function addIdea(
  doc: Document, graph: Graph, idea: { name: string; needs?: string[] },
): string {
  const id = nextId(graph);
  const node: Record<string, unknown> = { id, name: idea.name, status: "todo" };
  if (idea.needs?.length) node.needs = idea.needs;
  doc.addIn(["ideas"], node);
  graph.ideas.push({ id, name: idea.name, status: "todo", needs: idea.needs });
  return id;
}

export function appendProjectLog(logFile: string, entry: ProjectLogEntry): void {
  mkdirSync(dirname(logFile), { recursive: true });
  if (!existsSync(logFile)) {
    writeFileSync(logFile, "# Change log\n\nAppend-only. Every code, doc, and idea change goes here.\n");
  }
  const lines = [
    ``,
    `## ${entry.date}${entry.by ? " · " + entry.by : ""}`,
    ...(entry.ideas?.length ? [`- ideas: ${entry.ideas.join(", ")}`] : []),
    ...(entry.files?.length ? [`- files: ${entry.files.join(", ")}`] : []),
    `- note: ${entry.note}`,
    ``,
  ];
  appendFileSync(logFile, lines.join("\n"));
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
    <dt>这个想法是什么</dt><dd>${esc(i.what) || NONE}</dd>
    <dt>为什么有这个想法</dt><dd>${esc(i.why) || NONE}</dd>
    <dt>预期结果是什么</dt><dd>${esc(i.expected) || NONE}</dd>
    <dt>要如何实现</dt><dd>${esc(i.how) || NONE}</dd>
    <dt>为什么要这样实现</dt><dd>${esc(i.why_this_way) || NONE}</dd>
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
  .graph { background:#0d1117; border:1px solid #1f2933; border-radius:10px; padding:14px; margin:14px 0 26px; overflow:auto; }
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
<div class="graph"><pre class="mermaid">${mermaid.join("\n")}</pre></div>
<h2>想法详情</h2>
${g.ideas.map(card).join("\n")}
<script type="module">
  import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
  mermaid.initialize({ startOnLoad: true, securityLevel: "loose", theme: "dark" });
  function gotoNode(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
  }
  window.nodeClick = gotoNode;
  document.querySelectorAll("[data-goto]").forEach((a) =>
    a.addEventListener("click", (e) => { e.preventDefault(); gotoNode(a.getAttribute("data-goto")); }));
</script></body></html>`;
}

// ─── cli ────────────────────────────────────────────────────────────────────

const SEED = `version: 1
agent: ${AGENT}
project: PROJECT_NAME
overview: >
  一段话说清这个项目在做什么。

# 写代码闸门。false 关闭。exempt 里的路径（例如 cursor-companion/**）不拦。
enforce: true
exempt: []

# 终点：什么叫"这个项目做完了"。每个都是下面某个想法的 id。
endpoints: []

ideas: []
`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function csv(value: string | undefined): string[] {
  return (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

function isMain(): boolean {
  const self = fileURLToPath(import.meta.url);
  const invoked = argv[1] && resolve(argv[1]);
  return Boolean(invoked && self.toLowerCase() === invoked.toLowerCase());
}

export function main(args: string[]): number {
  const command = args[0];
  const projectDir = resolve(flag(args, "project") ?? cwd());
  const names = ledgerNames(projectDir);
  const file = resolve(flag(args, "file") ?? join(projectDir, "ideas", names.graph));
  const logFile = resolve(flag(args, "log") ?? join(projectDir, "ideas", names.log));
  const today = flag(args, "date") ?? new Date().toISOString().slice(0, 10);

  if (command === "paths") {
    console.log(`graph  ideas/${names.graph}`);
    console.log(`html   ideas/${names.html}`);
    console.log(`log    ideas/${names.log}`);
    return 0;
  }

  if (command === "init") {
    if (existsSync(file)) { console.log(`already there: ${file}`); return 0; }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, SEED.replace("PROJECT_NAME", projectDir.split(/[\\/]/).pop() ?? "project"));
    if (!existsSync(logFile)) {
      writeFileSync(logFile, "# Change log\n\nAppend-only. Every code, doc, and idea change goes here.\n");
    }
    console.log(`created ${file}`);
    return 0;
  }

  if (command === "log") {
    const note = flag(args, "note") ?? args[1];
    if (!note) { console.error("usage: ideas.ts log --note \"...\" [--by who] [--ideas I-001,I-002] [--files a.ts,b.md]"); return 2; }
    appendProjectLog(logFile, {
      date: today, by: flag(args, "by"), ideas: csv(flag(args, "ideas")),
      files: csv(flag(args, "files")), note,
    });
    console.log(`appended ${logFile}`);
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
      if (graph.ideas.length === 0) {
        console.log("no ideas yet — run /idea-onboard");
        return 0;
      }
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
        ["1 这个想法是什么", idea.what], ["2 为什么有这个想法", idea.why], ["3 预期结果是什么", idea.expected],
        ["4 要如何实现", idea.how], ["5 为什么要这样实现", idea.why_this_way],
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
    case "new": {
      const name = args[1];
      if (!name) { console.error("usage: ideas.ts new \"短名称\" [--needs I-001,I-002]"); return 2; }
      const id = addIdea(doc, graph, { name, needs: csv(flag(args, "needs")) });
      save(file, doc);
      appendProjectLog(logFile, { date: today, by: flag(args, "by") ?? "idea-discuss", ideas: [id], note: `created ${name}` });
      console.log(id);
      return 0;
    }
    case "set": {
      const force = args.includes("--force");
      setStatus(doc, graph, args[1], args[2] as Status,
        { by: flag(args, "by"), note: flag(args, "note"), date: today },
        { runVerify: args[2] === "done", force, projectDir });
      save(file, doc);
      appendProjectLog(logFile, {
        date: today, by: flag(args, "by"), ideas: [args[1]],
        files: csv(flag(args, "files")),
        note: (flag(args, "note") || `${args[1]} → ${args[2]}`) + (force ? " — FORCED" : ""),
      });
      console.log(`${args[1]} → ${args[2]}${force ? " (forced)" : ""}`);
      return 0;
    }
    case "allow": {
      if (!args[1]) { console.error("usage: ideas.ts allow <path>"); return 2; }
      const rel = relative(projectDir, resolve(projectDir, args[1])).replace(/\\/g, "/");
      const d = decideWrite(graph, rel, projectDir);
      console.log(`${d.allow ? "allow" : "deny"}  ${rel}  ${d.reason}`);
      return d.allow ? 0 : 1;
    }
    case "enforce": {
      const on = args[1] !== "off";
      doc.set("enforce", on);
      save(file, doc);
      appendProjectLog(logFile, { date: today, by: flag(args, "by") ?? "human", note: `enforce → ${on}` });
      console.log(`enforce ${on}`);
      return 0;
    }
    case "render": {
      const out = file.replace(/\.ya?ml$/, ".html");
      writeFileSync(out, render(graph));
      console.log(`wrote ${out} (${graph.ideas.length} ideas)`);
      return 0;
    }
    default:
      console.error("usage: ideas.ts check | next | show <id> | new <name> | set <id> <status> | allow <path> | enforce on|off | log | render | init | paths");
      console.error("       [--file ideas/graph.yaml] [--project .] [--by who] [--note text] [--files a,b] [--ideas I-001] [--force]");
      return 2;
  }
}

if (isMain()) {
  try {
    exit(main(argv.slice(2)));
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    exit(1);
  }
}
