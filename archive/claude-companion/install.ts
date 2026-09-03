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
  remember(target);
  return { installed, skipped };
}

// ─── keeping installs up to date ────────────────────────────────────────────
// The engine (ideas.ts / guard.ts) is never copied, so fixing it fixes every
// repo at once. The five command files ARE copies, and copies go stale. This
// is the registry that makes "update everywhere" possible.

export const registryPath = join(HERE, ".installs.json");

/** Recorded targets, minus any that have since been deleted or uninstalled. */
export function targets(): string[] {
  if (!existsSync(registryPath)) return [];
  try {
    const list = JSON.parse(readFileSync(registryPath, "utf8")) as string[];
    return list.filter((t) => existsSync(join(t, ".claude", "commands")));
  } catch {
    return [];
  }
}

function remember(target: string): void {
  const known = new Set(targets());
  known.add(resolve(target));
  writeFileSync(registryPath, JSON.stringify([...known].sort(), null, 2) + "\n");
}

export type FileState = "current" | "stale" | "missing" | "foreign";

/**
 * Compare against what this source would produce right now. No version numbers:
 * a number you have to remember to bump is a number that will eventually be
 * wrong, and the content already knows whether it matches.
 *
 * Line endings are normalised first. On Windows git hands you CRLF sources
 * while the installed copies are LF, so a raw byte comparison reports every
 * install as stale forever — which makes the whole check worthless.
 */
const sameText = (a: string, b: string) => a.replaceAll("\r\n", "\n") === b.replaceAll("\r\n", "\n");

export function statusOf(target: string): Record<string, FileState> {
  const report: Record<string, FileState> = {};
  for (const name of readdirSync(join(HERE, "commands")).filter((f) => f.endsWith(".md"))) {
    const destination = join(target, ".claude", "commands", name);
    if (!existsSync(destination)) { report[name] = "missing"; continue; }
    const actual = readFileSync(destination, "utf8");
    if (!actual.includes("ideas.ts")) report[name] = "foreign";
    else report[name] = sameText(actual, portable(readFileSync(join(HERE, "commands", name), "utf8"), HERE))
      ? "current" : "stale";
  }
  return report;
}

/** Re-install into every recorded target. Foreign files are still left alone. */
export function updateAll(): Array<{ target: string; changed: string[] }> {
  return targets().map((target) => {
    const before = statusOf(target);
    install(target);
    const changed = Object.entries(before)
      .filter(([, state]) => state === "stale" || state === "missing")
      .map(([name]) => name);
    return { target, changed };
  });
}

if (argv[1]?.endsWith("install.ts")) {
  const arg = argv[2];
  try {
    if (arg === "--status") {
      const known = targets();
      if (known.length === 0) console.log("还没有记录任何安装。");
      for (const target of known) {
        const report = statusOf(target);
        const counts = Object.values(report).reduce<Record<string, number>>(
          (acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {});
        const summary = Object.entries(counts).map(([s, n]) => `${s} ${n}`).join(" · ");
        console.log(`${counts.current === Object.keys(report).length ? "最新" : "需更新"}  ${target}   (${summary})`);
        for (const [name, state] of Object.entries(report)) {
          if (state !== "current") console.log(`        ${name}: ${state}`);
        }
      }
    } else if (arg === "--update") {
      const results = updateAll();
      if (results.length === 0) console.log("还没有记录任何安装。");
      for (const { target, changed } of results) {
        console.log(`${changed.length ? "已更新" : "本来就最新"}  ${target}${changed.length ? "   " + changed.join(", ") : ""}`);
      }
    } else if (!arg) {
      console.error("usage: install.ts <target-repo> [--force]");
      console.error("       install.ts --status    看每个已安装仓库是否最新");
      console.error("       install.ts --update    把命令文件刷新到所有已安装仓库");
      exit(2);
    } else {
      const { installed, skipped } = install(resolve(arg), argv.includes("--force"));
      console.log(`installed into ${resolve(arg)}:\n  ${installed.join("\n  ")}`);
      if (skipped.length > 0) {
        console.log(`\nskipped (already exists, not ours — pass --force to overwrite):\n  ${skipped.join("\n  ")}`);
      }
      console.log(`\nnext: run /ccscan in that repo.`);
    }
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    exit(1);
  }
}
