#!/usr/bin/env node
// afterFileEdit -> append one short entry to this companion's log. Fail open.
// Never rewrite the log. Skip the log itself, generated HTML, binaries, secrets.

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const OTHER_LEDGER =
  /(?:^|[/\\])ideas[/\\](log(\.[^/\\]+)?\.md|graph(\.[^/\\]+)?\.html)$/i;
const SKIP_DIR =
  /(?:^|[/\\])(node_modules|[/\\]\.git[/\\]|[/\\]\.cursor[/\\]companion[/\\])/i;
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|exe|dll|wasm|bin|woff2?)$/i;
const SECRET = /(^|[/\\])(\.env|credentials\.json|secrets?|\.pem|\.key)(\.|$|[/\\])/i;

function kind(rel) {
  if (/^ideas[/\\]/.test(rel) && /\.ya?ml$/i.test(rel)) return "idea";
  if (/\.(md|mdc|txt|rst)$/i.test(rel)) return "doc";
  return "code";
}

function hunkSummary(edits) {
  if (!Array.isArray(edits) || edits.length === 0) return "edits: 0";
  let plus = 0, minus = 0;
  const first = [];
  for (const e of edits) {
    const oldL = String(e?.old_string ?? "").split("\n").length;
    const newL = String(e?.new_string ?? "").split("\n").length;
    minus += oldL;
    plus += newL;
    const line = String(e?.new_string ?? "").split("\n").find((l) => l.trim());
    if (line && first.length < 2) first.push(line.trim().slice(0, 80));
  }
  const hint = first.length ? ` · ${first.join(" / ")}` : "";
  return `hunks: ${edits.length}  +${plus}/-${minus}${hint}`;
}

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

const raw = (await readStdin()).replace(/^\uFEFF/, "");
try {
  const input = JSON.parse(raw || "{}");
  const filePath = String(input.file_path || "");
  const cwd = process.cwd();
  const rel = (filePath ? relative(cwd, filePath) : "").replace(/\\/g, "/");
  if (!rel || rel.startsWith("..") || SKIP_DIR.test(rel) || BINARY.test(rel) || SECRET.test(rel)) {
    process.stdout.write("{}\n");
    process.exit(0);
  }
  const lib = await loadLib();
  const names = lib ? lib.ledgerNames(cwd) : { log: "log.md", html: "graph.html" };
  const oursLog = `ideas/${names.log}`;
  const oursHtml = `ideas/${names.html}`;
  if (rel === oursLog || rel === oursHtml || OTHER_LEDGER.test(rel)) {
    process.stdout.write("{}\n");
    process.exit(0);
  }
  const dir = join(cwd, "ideas");
  const logFile = join(dir, names.log);
  mkdirSync(dir, { recursive: true });
  if (!existsSync(logFile)) {
    writeFileSync(logFile, "# Change log\n\nAppend-only. Every code, doc, and idea change goes here.\n");
  }
  const date = new Date().toISOString().slice(0, 19).replace("T", " ");
  const body = [
    ``,
    `## ${date} · hook · ${kind(rel)}`,
    `- file: ${rel}`,
    `- ${hunkSummary(input.edits)}`,
    ``,
  ].join("\n");
  appendFileSync(logFile, body);
} catch {
  // fail open
}
process.stdout.write("{}\n");
