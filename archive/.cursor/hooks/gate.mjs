#!/usr/bin/env node
// preToolUse write-gate. Fail closed: a crash or missing yaml denies the edit.

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function readStdin() {
  return new Promise((resolveP) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => { raw += c; });
    process.stdin.on("end", () => resolveP(raw));
    process.stdin.on("error", () => resolveP(raw));
  });
}

function reply(permission, reason) {
  const agent_message = permission === "deny"
    ? `Cursor Companion blocked this write. ${reason}`
    : undefined;
  const user_message = permission === "deny" ? reason : undefined;
  process.stdout.write(JSON.stringify({ permission, agent_message, user_message }) + "\n");
}

function loadYaml(cwd) {
  const candidates = [
    join(cwd, ".cursor/companion/node_modules/yaml"),
    join(cwd, "cursor-companion/node_modules/yaml"),
    join(cwd, "node_modules/yaml"),
  ];
  for (const p of candidates) {
    if (existsSync(join(p, "package.json"))) {
      return createRequire(join(p, "package.json"))("yaml");
    }
  }
  return null;
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
  throw new Error("gate-lib.mjs not found — re-run cursor-companion/install.ts");
}

const raw = (await readStdin()).replace(/^\uFEFF/, "");
try {
  const input = JSON.parse(raw || "{}");
  const lib = await loadLib();
  const tool = input.tool_name ?? input.tool ?? "";
  if (!lib.isWriteTool(tool)) {
    reply("allow");
    process.exit(0);
  }
  const filePath = lib.extractWritePath(tool, input.tool_input ?? input);
  if (!filePath) {
    reply("deny", "write tool with no file path");
    process.exit(0);
  }
  const cwd = resolve(input.cwd || process.cwd());
  const rel = relative(cwd, resolve(cwd, filePath));
  if (!rel || rel.startsWith("..")) {
    reply("deny", "path is outside the project");
    process.exit(0);
  }

  const graphFile = lib.graphPath(cwd);
  let graph = { enforce: true, ideas: [], exempt: [] };
  if (existsSync(graphFile)) {
    const yaml = loadYaml(cwd);
    if (!yaml) {
      reply("deny", "yaml package missing — npm install in .cursor/companion (or repo root)");
      process.exit(0);
    }
    graph = yaml.parse(readFileSync(graphFile, "utf8")) ?? graph;
    if (!Array.isArray(graph.ideas)) graph.ideas = [];
  }

  const decision = lib.decideWrite(graph, rel.replace(/\\/g, "/"), cwd);
  reply(decision.allow ? "allow" : "deny", decision.reason);
} catch (err) {
  reply("deny", String(err instanceof Error ? err.message : err));
}
