#!/usr/bin/env npx tsx
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { loadRegistry, getRegistryPath } from "./lib/registry.ts";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npx tsx scripts/status.ts

Show status of all AI Dev Companion installations.
Displays: target path, install date, enforce mode, health check.
`);
  process.exit(0);
}

const registry = loadRegistry();

console.log("AI Dev Companion — Installation Status");
console.log("=".repeat(50));
console.log(`Registry: ${getRegistryPath()}`);
console.log(`AI Dev Root: ${registry.aidev_root || "(not set)"}`);
console.log(`Targets: ${registry.targets.length}`);
console.log();

if (registry.targets.length === 0) {
  console.log("No targets installed. Run:");
  console.log("  npx tsx scripts/install.ts <project-path> --enforce");
  process.exit(0);
}

for (const target of registry.targets) {
  const targetPath = resolve(target.path);
  const exists = existsSync(targetPath);

  const checks = exists ? runHealthChecks(targetPath) : [];

  console.log(`${exists ? "+" : "!"} ${targetPath}`);
  console.log(`  Installed: ${formatDate(target.installed_at)}`);
  console.log(`  Updated:   ${formatDate(target.updated_at)}`);
  console.log(`  Enforce:   ${target.enforce ? "yes (PreToolUse guard active)" : "no (PostToolUse only)"}`);
  console.log(`  Commands:  ${target.commands ? "yes" : "no"}`);
  console.log(`  Agent:     ${target.agent ?? "both"}`);

  if (!exists) {
    console.log(`  Health:    MISSING (directory does not exist)`);
  } else if (checks.length === 0) {
    console.log(`  Health:    OK`);
  } else {
    console.log(`  Health:    ${checks.length} issue(s)`);
    for (const issue of checks) {
      console.log(`    - ${issue}`);
    }
  }
  console.log();
}

function runHealthChecks(targetPath: string): string[] {
  const issues: string[] = [];

  if (!existsSync(join(targetPath, ".devcompanion"))) {
    issues.push(".devcompanion/ directory missing");
  }

  const agent = targetAgent(targetPath);
  if ((agent === "claude" || agent === "both") && !existsSync(join(targetPath, ".claude", "settings.json"))) {
    issues.push(".claude/settings.json missing");
  }

  if ((agent === "claude" || agent === "both") && !existsSync(join(targetPath, "CLAUDE.md"))) {
    issues.push("CLAUDE.md missing");
  }

  if ((agent === "codex" || agent === "both") && !existsSync(join(targetPath, ".codex", "hooks.json"))) {
    issues.push(".codex/hooks.json missing");
  }
  if ((agent === "codex" || agent === "both") && !existsSync(join(targetPath, ".agents", "skills"))) {
    issues.push(".agents/skills/ directory missing");
  }

  if (!existsSync(join(targetPath, "docs", "ecl"))) {
    issues.push("docs/ecl/ directory missing");
  }

  if (registry.aidev_root) {
    const hookPath = join(registry.aidev_root, "packages", "hook", "dist", "index.js");
    if (!existsSync(hookPath)) {
      issues.push("Hook not built (run 'npm run build' in ai-companion)");
    }

    const preHookPath = join(registry.aidev_root, "packages", "hook", "dist", "pre-tool-use.js");
    if (!existsSync(preHookPath)) {
      issues.push("PreToolUse hook not built");
    }
  }

  return issues;
}

function targetAgent(targetPath: string): "claude" | "codex" | "both" {
  const entry = registry.targets.find((target) => resolve(target.path) === resolve(targetPath));
  return entry?.agent ?? "both";
}

function formatDate(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleDateString("zh-CN") + " " + date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}
