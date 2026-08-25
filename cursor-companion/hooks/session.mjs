#!/usr/bin/env node
// sessionStart -> remind the agent this project is an idea graph.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function readStdin() {
  return new Promise((resolve) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => { raw += c; });
    process.stdin.on("end", () => resolve(raw));
    process.stdin.on("error", () => resolve(raw));
  });
}

async function loadLib() {
  const here = dirname(fileURLToPath(import.meta.url));
  const cwd = process.cwd();
  const candidates = [
    join(here, "../gate-lib.mjs"),
    join(here, "../companion/gate-lib.mjs"),
    join(cwd, ".cursor/companion/gate-lib.mjs"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return import(pathToFileURL(p).href);
  }
  return null;
}

await readStdin();

const cwd = process.cwd();
const lib = await loadLib();
const names = lib ? lib.ledgerNames(cwd) : { graph: "graph.yaml", log: "log.md", html: "graph.html" };
const graph = join(cwd, "ideas", names.graph);
const html = join(cwd, "ideas", names.html);
const engine = join(cwd, ".cursor", "companion", "ideas.ts");
const fallback = join(cwd, "cursor-companion", "ideas.ts");

const engineLine = existsSync(engine)
  ? "Engine: npx tsx .cursor/companion/ideas.ts"
  : existsSync(fallback)
    ? "Engine: npx tsx cursor-companion/ideas.ts (run install.ts . to copy into .cursor/)"
    : "Engine missing — run npx tsx cursor-companion/install.ts .";

const lines = [
  "Cursor Companion HARNESS is on. Product-code writes are denied unless an idea is `doing` and the file is in that idea's `code` / verify command.",
  `Ledger (always allowed): ideas/${names.graph}, ideas/${names.log}, ideas/${names.html}.`,
  "If those plain names were already taken by Claude or Codex, this companion uses the `.cursor` suffix. `ideas.ts paths` prints the resolved files.",
  "Unlock a file: npx tsx .cursor/companion/ideas.ts set <id> doing",
  "Emergency off: npx tsx .cursor/companion/ideas.ts enforce off",
  `Idea graph: ideas/${names.graph} (${existsSync(graph) ? "present" : "not created — /idea-onboard or ideas.ts init"})`,
  existsSync(html) ? `Visual: ideas/${names.html}` : null,
  engineLine,
  "Skills: /idea-onboard · /idea-discuss · /idea-build · /idea-debug · /idea-record",
].filter(Boolean);

process.stdout.write(JSON.stringify({ additional_context: lines.join("\n") }) + "\n");
