#!/usr/bin/env tsx
// Render a docs/ecl/dag/<repo>.ecl.yaml into a self-contained interactive HTML:
// a PAGED, FTB-Quests-tech-tree-style view. A left sidebar paginates by layer
// (Overview + one collapsible group per layer); the right pane shows one page at
// a time — the Overview page is the full milestone DAG, and each milestone page
// is that milestone + its FN tasks. Clicking a node opens its 5-question record.
// Generated from the YAML so edges never drift from the data (unlike the
// hand-authored .md, which has to be kept in sync by hand).
//
//   npx tsx scripts/render-dag.ts [docs/ecl/dag/ai-companion.ecl.yaml]
//
// ponytail: Mermaid (CDN) does graph layout — no d3/cytoscape. Static HTML, no build.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { argv } from "node:process";
import { parse } from "yaml";

interface Node {
  id: string;
  name?: string;
  parent?: string;
  layer?: string;
  status?: string;
  depends_on?: string[];
  what?: string; why?: string; how?: string; why_this_way?: string; expected?: string;
}
interface Layer {
  name: string;
  what?: string; why?: string; how?: string; why_this_way?: string; expected?: string;
}
interface Dag {
  feature?: string; repo?: string; overview?: string;
  endpoints?: string[];
  layers?: Layer[];
  milestones?: Node[]; tasks?: Node[];
  dependency_graph?: Record<string, string[]>;
  left_off?: { summary?: string; done?: string[]; in_progress?: string[];
    frontier_next?: string[]; blocked_until?: Record<string, string> };
}

// Layer order for the sidebar (FTB tech-tree grouping).
const LAYER_ORDER = ["Foundation", "Capture", "Engines", "Skills", "Endpoints"];

export function renderDag(inPath: string): string {
  const dag: Dag = parse(readFileSync(inPath, "utf8"));
  const milestones = dag.milestones ?? [];
  const tasks = dag.tasks ?? [];
  const endpoints = new Set(dag.endpoints ?? []);
  const all = [...milestones, ...tasks];
  const byId = new Map(all.map((n) => [n.id, n]));

  const esc = (s = "") => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const mid = (id: string) => "n_" + id.replace(/[^A-Za-z0-9]/g, "_");      // mermaid-safe id
  const cls = (n: Node) => (endpoints.has(n.id) ? "terminal" : n.status ?? "pending");
  // mermaid label: ID + name, <br> line break (no quotes/parens that break the parser)
  const label = (n: Node) => `${n.id}<br>${(n.name ?? "").replace(/["()]/g, "")}`;
  const STATUS_ZH: Record<string, string> = { done: "已完成", "in-progress": "进行中", pending: "待办", blocked: "受阻" };
  const statusLabel = (n: Node) => endpoints.has(n.id) ? "终点" : (STATUS_ZH[n.status ?? "pending"] ?? n.status ?? "");
  // Layer display names (data keeps the English key for stable anchors/verify).
  const LAYER_ZH: Record<string, string> = { Foundation: "基础层", Capture: "捕获层", Engines: "引擎层", Skills: "命令层", Endpoints: "终点层" };
  const layerZh = (name: string) => LAYER_ZH[name] ?? name;

  function mermaid(nodes: Node[], edges: [string, string][]): string {
    const present = new Set(nodes.map((n) => n.id));
    const L = [
      "flowchart TD",
      "classDef done fill:#1b5e20,stroke:#a5d6a7,color:#fff;",
      "classDef pending fill:#37474f,stroke:#b0bec5,color:#fff,stroke-dasharray:5 3;",
      "classDef blocked fill:#5d4037,stroke:#bcaaa4,color:#fff,stroke-dasharray:2 2;",
      "classDef terminal fill:#4a148c,stroke:#ce93d8,color:#fff,stroke-width:3px;",
    ];
    for (const n of nodes) L.push(`${mid(n.id)}["${label(n)}"]`);
    for (const [a, b] of edges) if (present.has(a) && present.has(b)) L.push(`${mid(a)} --> ${mid(b)}`);
    const buckets: Record<string, string[]> = {};
    for (const n of nodes) (buckets[cls(n)] ??= []).push(mid(n.id));
    for (const [c, ids] of Object.entries(buckets)) L.push(`class ${ids.join(",")} ${c};`);
    for (const n of nodes) L.push(`click ${mid(n.id)} call nodeClick("${n.id}")`);
    return L.join("\n");
  }

  // Milestone graph: edges from dependency_graph.
  const featEdges: [string, string][] = Object.entries(dag.dependency_graph ?? {})
    .flatMap(([to, deps]) => deps.map((from) => [from, to] as [string, string]));

  const record = (n: Node) => `<section class="rec ${cls(n)}" id="${n.id}">
  <h3>${esc(n.id)} · ${esc(n.name)} <span class="badge">${statusLabel(n)}</span></h3>
  ${n.parent ? `<p class="parent">所属里程碑：${esc(n.parent)}</p>` : ""}
  <dl>
    <dt>是什么</dt><dd>${esc(n.what)}</dd>
    <dt>为什么做</dt><dd>${esc(n.why)}</dd>
    <dt>如何做</dt><dd>${esc(n.how)}</dd>
    <dt>为什么这样做</dt><dd>${esc(n.why_this_way)}</dd>
    <dt>期望结果</dt><dd>${esc(n.expected)}</dd>
  </dl>
</section>`;

  // Prominent per-layer ("tech tree") 5-question summary.
  const layerSummary = (l: Layer) => `<section class="tree-summary" data-layer-summary="${esc(l.name)}">
  <h3>${esc(layerZh(l.name))} 技能树 · 五问总结</h3>
  <dl>
    <dt>是什么</dt><dd>${esc(l.what)}</dd>
    <dt>为什么做</dt><dd>${esc(l.why)}</dd>
    <dt>如何做</dt><dd>${esc(l.how)}</dd>
    <dt>为什么这样做</dt><dd>${esc(l.why_this_way)}</dd>
    <dt>期望结果</dt><dd>${esc(l.expected)}</dd>
  </dl>
</section>`;

  // ---- Sidebar: Overview + one page link per layer (each layer is a "tech tree") ----
  const presentLayers = LAYER_ORDER.filter((layer) => milestones.some((m) => m.layer === layer));
  const sidebar: string[] = [];
  sidebar.push(`<a class="page-link layer-link" data-target="page-overview" href="#page-overview">总览</a>`);
  for (const layer of presentLayers) {
    const inLayer = milestones.filter((m) => m.layer === layer);
    sidebar.push(`<a class="page-link layer-link" data-target="page-${layer}" href="#page-${layer}"><b>${esc(layerZh(layer))}</b> <span class="count">${inLayer.length}</span></a>`);
  }

  // ---- Overview page: the full milestone DAG ----
  const overviewPage = `<section class="page active" data-page="overview" id="page-overview">
  <h2>总览</h2>
  <p class="overview">${esc(dag.overview)}</p>
  <div class="graph"><pre class="mermaid">${mermaid(milestones, featEdges)}</pre></div>
  <h3 class="sub">里程碑详解</h3>
  ${milestones.map(record).join("\n")}
</section>`;

  // ---- One page per layer ("tech tree"): 5-question summary + the layer's full DAG ----
  const layersById = new Map((dag.layers ?? []).map((l) => [l.name, l]));
  const layerPages = presentLayers.map((layerName) => {
    const inLayer = milestones.filter((m) => m.layer === layerName);
    const inLayerIds = new Set(inLayer.map((m) => m.id));
    // "complete DAG": the layer's milestones plus their direct dependency neighbours
    // (so cross-layer context like render->dashboard is visible, not an isolated node).
    const nodeIds = new Set(inLayerIds);
    for (const [a, b] of featEdges) if (inLayerIds.has(a) || inLayerIds.has(b)) { nodeIds.add(a); nodeIds.add(b); }
    const nodes = [...nodeIds].map((id) => byId.get(id)).filter((n): n is Node => !!n);
    const edges = featEdges.filter(([a, b]) => nodeIds.has(a) && nodeIds.has(b));
    const ls = layersById.get(layerName);
    return `<section class="page" data-page="${layerName}" id="page-${layerName}">
  <h2>${esc(layerZh(layerName))} 技能树</h2>
  ${ls ? layerSummary(ls) : ""}
  <div class="graph"><pre class="mermaid">${mermaid(nodes, edges)}</pre></div>
  <h3 class="sub">里程碑详解（五问）</h3>
  ${inLayer.map(record).join("\n")}
</section>`;
  }).join("\n");

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(dag.repo ?? dag.feature ?? "DAG")} — 依赖关系图（DAG）</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { font: 15px/1.55 system-ui,sans-serif; margin: 0; background:#11151a; color:#e6edf3; }
  .layout { display:flex; align-items:stretch; min-height:100vh; }
  /* ---- sidebar ---- */
  .sidebar { width:300px; flex:0 0 300px; background:#0d1117; border-right:1px solid #222b34;
    padding:16px 12px; position:sticky; top:0; align-self:flex-start; height:100vh; overflow:auto; }
  .sidebar h1 { font-size:16px; margin:0 0 12px; }
  .page-link { display:block; color:#c9d4df; text-decoration:none; font-size:14px;
    padding:8px 10px; margin:3px 0; border-radius:6px; border-left:2px solid transparent; }
  .page-link:hover { background:#161b22; color:#e6edf3; }
  .page-link.current { background:#1f6feb22; color:#e6edf3; border-left-color:#58a6ff; }
  .count { font-size:11px; color:#7d8896; background:#222b34; border-radius:10px; padding:1px 7px; margin-left:4px; }
  /* ---- main pane ---- */
  .main { flex:1 1 auto; min-width:0; padding:24px; max-width:1100px; }
  h1.title { margin:0 0 4px; }
  .overview { color:#9aa7b4; max-width:70ch; }
  .legend span { display:inline-block; margin-right:14px; font-size:13px; }
  .sw { display:inline-block; width:12px; height:12px; border-radius:3px; vertical-align:-1px; margin-right:5px; }
  .graph { background:#0d1117; border:1px solid #222b34; border-radius:10px; padding:12px; margin:16px 0; overflow:auto; }
  h2 { border-bottom:1px solid #222b34; padding-bottom:6px; margin-top:8px; }
  h3.sub { border-bottom:1px solid #222b34; padding-bottom:6px; margin-top:28px; color:#c9d4df; }
  .layerbadge { font-size:12px; padding:2px 9px; border-radius:10px; background:#222b34; color:#9aa7b4; font-weight:normal; vertical-align:middle; }
  .rec { border:1px solid #222b34; border-left:4px solid #555; border-radius:8px; padding:12px 16px; margin:12px 0; scroll-margin-top:12px; }
  .rec.done { border-left-color:#1b5e20; } .rec.pending { border-left-color:#37474f; }
  .rec.blocked { border-left-color:#5d4037; } .rec.terminal { border-left-color:#4a148c; }
  .rec h3 { margin:0 0 8px; font-size:16px; }
  .rec.flash { animation: flash 1.2s ease-out; }
  @keyframes flash { from { background:#1f6feb55; } to { background:transparent; } }
  .badge { font-size:11px; padding:2px 8px; border-radius:10px; background:#222b34; color:#9aa7b4; font-weight:normal; }
  /* ---- per-layer 5-question summary ---- */
  .tree-summary { background:#0d1117; border:1px solid #2d4a63; border-left:4px solid #58a6ff; border-radius:10px; padding:14px 18px; margin:14px 0; }
  .tree-summary h3 { margin:0 0 10px; font-size:15px; color:#cfe3ff; }
  .parent { margin:0 0 8px; font-size:13px; color:#9aa7b4; }
  dl { margin:0; display:grid; grid-template-columns:max-content 1fr; gap:4px 16px; }
  dt { color:#7d8896; white-space:nowrap; } dd { margin:0; }
  a { color:#58a6ff; } ul { line-height:1.8; }
  /* ---- pagination: exactly one page visible ---- */
  .page { display:none; }
  .page.active { display:block; }
</style></head><body>
<div class="layout">
  <nav class="sidebar">
    <h1>${esc(dag.repo ?? dag.feature ?? "DAG")}</h1>
    ${sidebar.join("\n")}
  </nav>
  <main class="main">
    <h1 class="title">${esc(dag.repo ?? dag.feature ?? "DAG")} — 依赖关系图（DAG）</h1>
    <p class="legend">
      <span><i class="sw" style="background:#1b5e20"></i>已完成</span>
      <span><i class="sw" style="background:#37474f"></i>待办</span>
      <span><i class="sw" style="background:#5d4037"></i>受阻</span>
      <span><i class="sw" style="background:#4a148c"></i>终点</span>
      <span>· 点击任意节点 → 查看它的五问记录</span>
    </p>
    ${overviewPage}
    ${layerPages}
  </main>
</div>
<script type="module">
  import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
  // Render every diagram up front: Mermaid can't size a diagram inside a
  // display:none container, so render all pages while they're laid out, then
  // paginate purely with CSS afterward.
  mermaid.initialize({ startOnLoad: false, securityLevel: "loose", theme: "dark" });

  function showPage(pageId) {
    document.querySelectorAll(".page").forEach((p) =>
      p.classList.toggle("active", p.id === pageId));
    document.querySelectorAll(".page-link").forEach((l) =>
      l.classList.toggle("current", l.getAttribute("data-target") === pageId));
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  document.querySelectorAll(".page-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      showPage(link.getAttribute("data-target"));
    });
  });

  window.nodeClick = (id) => {
    // record lives inside the currently-active page
    const page = document.querySelector(".page.active");
    const el = page ? page.querySelector("#" + CSS.escape(id)) : document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
  };

  // Render all diagrams once while the document is fully laid out, THEN switch
  // to single-page CSS pagination. We temporarily reveal each page so Mermaid
  // can measure it.
  (async () => {
    const pages = Array.from(document.querySelectorAll(".page"));
    const prevActive = document.querySelector(".page.active");
    for (const p of pages) {
      p.style.display = "block";
      await mermaid.run({ nodes: p.querySelectorAll(".mermaid") });
      p.style.display = "";
    }
    // restore default page = Overview
    showPage(prevActive ? prevActive.id : "page-overview");
  })();
</script></body></html>`;

  return html;
}

// Direct execution: parse argv, render, write the HTML file.
const isMain =
  (argv[1] && (() => { try { return fileURLToPath(import.meta.url) === argv[1]; } catch { return false; } })()) ||
  (argv[1] ? argv[1].endsWith("render-dag.ts") : false);

if (isMain) {
  const inPath = argv[2] ?? "docs/ecl/dag/ai-companion.ecl.yaml";
  const outPath = inPath.replace(/\.ecl\.yaml$|\.yaml$/, "") + ".html";
  const html = renderDag(inPath);
  const dag: Dag = parse(readFileSync(inPath, "utf8"));
  writeFileSync(outPath, html);
  console.log(`wrote ${outPath} (${(dag.milestones ?? []).length} milestones, ${(dag.tasks ?? []).length} tasks)`);
}
