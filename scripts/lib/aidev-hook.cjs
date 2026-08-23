#!/usr/bin/env node
/**
 * 3b — path-portable Claude/Codex hook wrapper.
 *
 * Claude Code on Windows runs hook `command` via cmd.exe and does not reliably
 * expand `$AIDEV_ROOT` / `${VAR}`. This wrapper is a repo-relative `node` script
 * with no baked-in absolute paths; it resolves the companion checkout at runtime:
 *   1. AIDEV_ROOT (companion checkout)
 *   2. DEVCOMPANION_ROOT only if that directory actually contains hook dist
 *      (in packages/hook it means the *target* project, so do not assume it)
 *   3. aidev_root in ~/.aidev-companion/registry.json (written by install.ts)
 *
 * Usage: node .claude/hooks/aidev-hook.cjs [index.js|pre-tool-use.js]
 */
"use strict";

const { spawn } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const { homedir } = require("node:os");
const { join } = require("node:path");

function looksLikeCompanionRoot(candidate) {
  return Boolean(
    candidate &&
      existsSync(join(candidate, "packages", "hook", "dist", "index.js"))
  );
}

function resolveCompanionRoot() {
  for (const candidate of [process.env.AIDEV_ROOT, process.env.DEVCOMPANION_ROOT]) {
    if (looksLikeCompanionRoot(candidate)) return candidate;
  }
  const registryFile = join(homedir(), ".aidev-companion", "registry.json");
  if (!existsSync(registryFile)) return null;
  try {
    const registry = JSON.parse(readFileSync(registryFile, "utf8"));
    if (looksLikeCompanionRoot(registry.aidev_root)) return registry.aidev_root;
  } catch {
    // ignore malformed registry
  }
  return null;
}

const scriptName = process.argv[2] || "index.js";
const root = resolveCompanionRoot();
if (!root) {
  process.stderr.write(
    "AI Dev Companion hook: companion root not found. Set AIDEV_ROOT or run install so ~/.aidev-companion/registry.json has aidev_root.\n"
  );
  process.exit(0);
}

const hookPath = join(root, "packages", "hook", "dist", scriptName);
if (!existsSync(hookPath)) {
  process.stderr.write(
    `AI Dev Companion hook missing: ${hookPath}. Run npm run build in the companion repo.\n`
  );
  process.exit(0);
}

const child = spawn(process.execPath, [hookPath], { stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
child.on("error", (error) => {
  process.stderr.write(`AI Dev Companion hook spawn failed: ${error.message}\n`);
  process.exit(0);
});
