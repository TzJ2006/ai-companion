#!/usr/bin/env npx tsx
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { installAgentConfig } from "./lib/install-agent-config.ts";
import { loadRegistry, saveRegistry, addTarget } from "./lib/registry.ts";

const args = process.argv.slice(2);

function printUsage(): void {
  console.log(`Usage: npx tsx scripts/install.ts <target-path> [options]

Install AI Dev Companion into a target project. This sets up:
  - .devcompanion/ directory structure
  - .claude/settings.json with PostToolUse hook (and PreToolUse if --enforce)
  - CLAUDE.md with constraint block
  - .claude/commands/ with skill entry points (ccplan, cconboard, ccdebug)

Options:
  --enforce        Install PreToolUse guard hook (warns before edits without active ECL)
  --no-commands    Skip installing .claude/commands/
  --help, -h       Show this help

Examples:
  npx tsx scripts/install.ts /path/to/my-project
  npx tsx scripts/install.ts /path/to/my-project --enforce
  npx tsx scripts/install.ts . --enforce
`);
}

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  printUsage();
  process.exit(args.length === 0 ? 1 : 0);
}

const targetPath = resolve(args[0]);
const enforce = args.includes("--enforce");
const includeCommands = !args.includes("--no-commands");

if (!existsSync(targetPath)) {
  console.error(`Error: Target path does not exist: ${targetPath}`);
  process.exit(1);
}

const aidevRoot = resolve(import.meta.dirname, "..");

console.log(`Installing AI Dev Companion...`);
console.log(`  Target: ${targetPath}`);
console.log(`  AI Dev Root: ${aidevRoot}`);
console.log(`  Enforce mode: ${enforce}`);
console.log(`  Commands: ${includeCommands}`);
console.log();

const result = installAgentConfig({
  targetPath,
  aidevRoot,
  enforce,
  includeCommands,
});

const registry = loadRegistry();
registry.aidev_root = aidevRoot;
saveRegistry(addTarget(registry, targetPath, enforce, includeCommands));

console.log("Installation complete:");
console.log(`  .devcompanion/ initialized: ${result.devcompanion_initialized}`);
console.log(`  .claude/settings.json updated: ${result.settings_json_updated}`);
console.log(`  CLAUDE.md updated: ${result.claude_md_updated}`);
console.log(`  PreToolUse guard installed: ${result.pre_tool_hook_installed}`);
if (result.commands_installed.length > 0) {
  console.log(`  Commands installed: ${result.commands_installed.join(", ")}`);
}
console.log();
console.log("Target registered. Use 'npx tsx scripts/update.ts' to refresh all targets after updating ai-companion.");
