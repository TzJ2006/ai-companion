#!/usr/bin/env npx tsx
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { installAgentConfig } from "./lib/install-agent-config.ts";
import { loadRegistry, saveRegistry, addTarget, normalizeTargetPath } from "./lib/registry.ts";
import { detectRepoVisibility, type RepoVisibility } from "./lib/detect-visibility.ts";

const args = process.argv.slice(2);

function printUsage(): void {
  console.log(`Usage: npx tsx scripts/install.ts <target-path> [options]

Install AI Dev Companion into a target project. This sets up:
  - .devcompanion/ directory structure
  - visibility-aware .gitignore (3a)
  - Claude hooks, CLAUDE.md, and slash commands
  - Codex hooks and .agents/skills adapters

Options:
  --enforce        Install PreToolUse guard hook (warns before edits without active ECL)
  --agent <name>   Install for claude, codex, or both (default: both)
  --no-commands    Skip installing .claude/commands/
  --public         Treat the target as a public repo (strict gitignore; default if detection fails)
  --private        Treat the target as a private repo (looser gitignore)
  --help, -h       Show this help

Examples:
  npx tsx scripts/install.ts /path/to/my-project
  npx tsx scripts/install.ts /path/to/my-project --enforce
  npx tsx scripts/install.ts . --enforce --public
`);
}

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  printUsage();
  process.exit(args.length === 0 ? 1 : 0);
}

const wantPublic = args.includes("--public");
const wantPrivate = args.includes("--private");
if (wantPublic && wantPrivate) {
  console.error("Error: --public and --private are mutually exclusive");
  process.exit(1);
}

const targetPath = normalizeTargetPath(args[0]);
const enforce = args.includes("--enforce");
const includeCommands = !args.includes("--no-commands");
const agentIndex = args.indexOf("--agent");
const agent = agentIndex >= 0 ? args[agentIndex + 1] : "both";
const visibilityFlag: RepoVisibility | undefined = wantPublic
  ? "public"
  : wantPrivate
    ? "private"
    : undefined;

if (agent !== "claude" && agent !== "codex" && agent !== "both") {
  console.error("Error: --agent must be one of claude, codex, or both");
  process.exit(1);
}

if (!existsSync(targetPath)) {
  console.error(`Error: Target path does not exist: ${targetPath}`);
  process.exit(1);
}

const aidevRoot = resolve(import.meta.dirname, "..");
const visibility = detectRepoVisibility(targetPath, { flag: visibilityFlag });

console.log(`Installing AI Dev Companion...`);
console.log(`  Target: ${targetPath}`);
console.log(`  AI Dev Root: ${aidevRoot}`);
console.log(`  Enforce mode: ${enforce}`);
console.log(`  Commands: ${includeCommands}`);
console.log(`  Agent: ${agent}`);
console.log(`  Visibility: ${visibility}${visibilityFlag ? " (flag)" : " (detected / public-safe default)"}`);
console.log();

const result = installAgentConfig({
  targetPath,
  aidevRoot,
  enforce,
  includeCommands,
  agent,
  visibility,
});

const registry = loadRegistry();
registry.aidev_root = aidevRoot;
saveRegistry(addTarget(registry, targetPath, enforce, includeCommands, agent, visibility));

console.log("Installation complete:");
console.log(`  .devcompanion/ initialized: ${result.devcompanion_initialized}`);
console.log(`  .gitignore updated: ${result.gitignore_updated}`);
console.log(`  .claude/settings.json updated: ${result.settings_json_updated}`);
console.log(`  CLAUDE.md updated: ${result.claude_md_updated}`);
console.log(`  PreToolUse guard installed: ${result.pre_tool_hook_installed}`);
console.log(`  .codex/hooks.json updated: ${result.codex_hooks_updated}`);
if (result.commands_installed.length > 0) {
  console.log(`  Commands installed: ${result.commands_installed.join(", ")}`);
}
if (result.codex_skills_installed.length > 0) {
  console.log(`  Codex skills installed: ${result.codex_skills_installed.join(", ")}`);
}
console.log();
console.log("Target registered. Use 'npx tsx scripts/update.ts' to refresh all targets after updating ai-companion.");
