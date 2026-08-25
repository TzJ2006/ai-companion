#!/usr/bin/env tsx
// Install the five commands into another repo.
//
//   npx tsx claude-companion/install.ts <target-repo> [--force]
//
// Copies commands/*.md into <target>/.claude/commands/ with the companion path
// rewritten to absolute, and seeds <target>/ideas/graph.claude.yaml.
//
// ponytail: the engine (ideas.ts) is NOT copied — every repo runs this one copy,
// so there is one version to fix. Uninstall = delete the five command files.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";
import { AGENT, agentName, graphPath } from "./ideas.js";

const HERE = dirname(fileURLToPath(import.meta.url));

export function portable(body: string, companionDir: string): string {
  // Command files are written against a repo-relative `claude-companion/`;
  // in a target repo that path does not exist, so point it at this install.
  return body.replaceAll("claude-companion/", companionDir.replaceAll("\\", "/") + "/");
}

interface HookEntry { type: string; command: string }
interface HookGroup { matcher?: string; hooks: HookEntry[] }

/**
 * Register the guard on the three events it needs, without disturbing hooks
 * another tool already put there. Idempotent: re-installing replaces our own
 * entry (paths may have moved) and leaves everything else alone.
 */
export function installHooks(target: string, companionDir: string): string[] {
  const settingsPath = join(target, ".claude", "settings.json");
  const settings = existsSync(settingsPath)
    ? JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>
    : {};
  const hooks = (settings.hooks ?? {}) as Record<string, HookGroup[]>;
  const command = `npx tsx "${companionDir.replaceAll("\\", "/")}/guard.ts"`;
  const registered: string[] = [];

  for (const [event, matcher] of [
    ["PreToolUse", "Edit|Write|NotebookEdit"],   // R2 R3 R4 R6 — block before the write lands
    ["PostToolUse", "Edit|Write|NotebookEdit|Read"], // R1 record, R7 strike scanned files
    ["Stop", undefined],                          // R5 — the graph must be sound to finish
    ["UserPromptSubmit", undefined],              // R6 — only the human can approve a graph
  ] as [string, string | undefined][]) {
    const groups = (hooks[event] ?? []).map((group) => ({
      ...group,
      hooks: (group.hooks ?? []).filter((h) => !h.command?.includes("guard.ts")),
    })).filter((group) => group.hooks.length > 0);

    const mine = groups.find((group) => group.matcher === matcher);
    if (mine) mine.hooks.push({ type: "command", command });
    else groups.push({ ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command }] });

    hooks[event] = groups;
    registered.push(event);
  }

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify({ ...settings, hooks }, null, 2) + "\n");
  return registered;
}

export function install(target: string, force = false): { installed: string[]; skipped: string[] } {
  if (!existsSync(target)) throw new Error(`no such directory: ${target}`);

  const commandsDir = join(target, ".claude", "commands");
  mkdirSync(commandsDir, { recursive: true });

  const installed: string[] = [];
  const skipped: string[] = [];
  for (const name of readdirSync(join(HERE, "commands")).filter((f) => f.endsWith(".md"))) {
    const destination = join(commandsDir, name);
    if (existsSync(destination) && !force) {
      // Never clobber a command another tool (or the user) owns without --force.
      const existing = readFileSync(destination, "utf8");
      if (!existing.includes("ideas.ts")) { skipped.push(name); continue; }
    }
    writeFileSync(destination, portable(readFileSync(join(HERE, "commands", name), "utf8"), HERE));
    installed.push(name.replace(/\.md$/, ""));
  }

  const graph = graphPath(target);
  if (!existsSync(graph)) {
    mkdirSync(dirname(graph), { recursive: true });
    writeFileSync(graph, `version: 1
agent: ${AGENT}
project: ${target.split(/[\\/]/).filter(Boolean).pop()}
overview: >
  （运行 /ccscan 填写）

endpoints: []

ideas: []
`);
    installed.push(`ideas/${basename(graph)}`);
  }

  // The graph and log.md are the record and belong in git. The rest is
  // per-machine state: a half-finished scan and one person's sign-off.
  const ignore = join(target, "ideas", ".gitignore");
  if (!existsSync(ignore)) {
    writeFileSync(ignore, [
      agentName(target, ".scan-todo"),
      agentName(target, ".approved"),
      basename(graph).replace(/\.ya?ml$/, ".html"),
    ].join("\n") + "\n");
    installed.push("ideas/.gitignore");
  }

  installed.push(`hooks: ${installHooks(target, HERE).join(", ")}`);
  return { installed, skipped };
}

if (argv[1]?.endsWith("install.ts")) {
  const target = argv[2];
  if (!target) { console.error("usage: install.ts <target-repo> [--force]"); exit(2); }
  try {
    const { installed, skipped } = install(resolve(target), argv.includes("--force"));
    console.log(`installed into ${resolve(target)}:\n  ${installed.join("\n  ")}`);
    if (skipped.length > 0) {
      console.log(`\nskipped (already exists, not ours — pass --force to overwrite):\n  ${skipped.join("\n  ")}`);
    }
    console.log(`\nnext: run /ccscan in that repo.`);
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    exit(1);
  }
}
