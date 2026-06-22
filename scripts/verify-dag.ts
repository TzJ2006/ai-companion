#!/usr/bin/env tsx
// Verification harness for the paged DAG view (ECL: docs/ecl/dag-paged-view.yaml).
//   npx tsx scripts/verify-dag.ts layers   # FN-001: every milestone has a `layer:`
//   npx tsx scripts/verify-dag.ts paged    # FN-002: rendered HTML has the paged shape
// Exit 0 = pass, 1 = fail (this is what @aidev/exec checks).

import { readFileSync } from "node:fs";
import { parse } from "yaml";

const YAML = "docs/ecl/dag/ai-companion.ecl.yaml";
const mode = process.argv[2];
const fail = (m: string) => { console.error("FAIL: " + m); process.exit(1); };

const dag: any = parse(readFileSync(YAML, "utf8"));
const milestones: any[] = dag.milestones ?? [];

async function main() {
if (mode === "layers") {
  const missing = milestones.filter((m) => !m.layer);
  if (missing.length) fail(`${missing.length} milestones missing layer: ${missing.map((m) => m.id).join(", ")}`);
  const layers = new Set(milestones.map((m) => m.layer));
  console.log(`PASS layers: ${milestones.length} milestones, ${layers.size} distinct layers (${[...layers].join(", ")})`);
} else if (mode === "paged") {
  const { renderDag } = await import("./render-dag.ts");      // FN-002 must export this
  const html: string = renderDag(YAML);
  const layers = new Set(milestones.map((m) => m.layer)).size;
  // One page per layer ("tech tree") + the Overview page; each page carries data-page=".
  const pages = (html.match(/data-page="/g) || []).length;
  const expectedPages = layers + 1;                           // layers + overview
  if (pages !== expectedPages) fail(`page_count ${pages} !== ${expectedPages} (layers+overview)`);
  // Each layer page carries one 5-question summary marked data-layer-summary.
  const summaries = (html.match(/data-layer-summary/g) || []).length;
  if (summaries !== layers) fail(`layer_summaries ${summaries} !== ${layers}`);
  if (!/data-page="overview"/.test(html)) fail('overview page (data-page="overview") missing');
  console.log(`PASS paged: ${pages} pages (${layers} layers + overview), ${summaries} layer 5-question summaries`);
} else {
  fail("usage: verify-dag.ts <layers|paged>");
}
}

main();
