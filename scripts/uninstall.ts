#!/usr/bin/env npx tsx
import { resolve, join } from "node:path";
import { existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { loadRegistry, saveRegistry, removeTarget } from "./lib/registry.ts";

const MARKER_START = "<!-- AI-DEV-COMPANION:START -->";
const MARKER_END = "<!-- AI-DEV-COMPANION:END -->";

const args = process.argv.slice(2);

function printUsage(): void {
  console.log(`Usage: npx tsx scripts/uninstall.ts <target-path> [options]

Remove AI Dev Companion from a target project. This removes:
  - Hook entries from .claude/settings.json
  - Constraint block from CLAUDE.md
  - .claude/commands/ skill files (ccplan, cconboard, ccdebug)
  - Registry entry

Does NOT remove:
  - .devcompanion/ directory (contains your change history)
  - docs/ecl/ directory (contains your feature constraints)

Options:
  --all            Remove from ALL registered targets
  --help, -h       Show this help

Examples:
  npx tsx scripts/uninstall.ts /path/to/my-project
  npx tsx scripts/uninstall.ts --all
`);
}

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  printUsage();
  process.exit(args.length === 0 ? 1 : 0);
}

const removeAll = args.includes("--all");
const registry = loadRegistry();

const targets = removeAll
  ? registry.targets.map((t) => t.path)
  : [resolve(args[0])];

if (targets.length === 0) {
  console.log("No targets to uninstall.");
  process.exit(0);
}

for (const targetPath of targets) {
  console.log(`Uninstalling from: ${targetPath}`);

  if (!existsSync(targetPath)) {
    console.log("  Directory does not exist, removing from registry only.");
    saveRegistry(removeTarget(registry, targetPath));
    continue;
  }

  removeHooksFromSettings(targetPath);
  removeConstraintBlockFromClaudeMd(targetPath);
  removeCommandFiles(targetPath);
  saveRegistry(removeTarget(registry, targetPath));

  console.log("  Done.");
}

saveRegistry(registry);
console.log(`\nUninstall complete. ${targets.length} target(s) processed.`);
console.log("Note: .devcompanion/ and docs/ecl/ were preserved (your data).");

function removeHooksFromSettings(targetPath: string): void {
  const settingsPath = join(targetPath, ".claude", "settings.json");
  if (!existsSync(settingsPath)) return;

  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const hooks = settings.hooks;
    if (!hooks) return;

    if (Array.isArray(hooks.PostToolUse)) {
      hooks.PostToolUse = hooks.PostToolUse.filter(
        (entry: Record<string, unknown>) =>
          !(JSON.stringify(entry).includes("ai-companion"))
      );
      if (hooks.PostToolUse.length === 0) delete hooks.PostToolUse;
    }

    if (Array.isArray(hooks.PreToolUse)) {
      hooks.PreToolUse = hooks.PreToolUse.filter(
        (entry: Record<string, unknown>) =>
          !(JSON.stringify(entry).includes("ai-companion"))
      );
      if (hooks.PreToolUse.length === 0) delete hooks.PreToolUse;
    }

    if (Object.keys(hooks).length === 0) {
      delete settings.hooks;
    }

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    console.log("  Removed hooks from .claude/settings.json");
  } catch {
    console.log("  Warning: could not parse .claude/settings.json");
  }
}

function removeConstraintBlockFromClaudeMd(targetPath: string): void {
  const claudeMdPath = join(targetPath, "CLAUDE.md");
  if (!existsSync(claudeMdPath)) return;

  let content = readFileSync(claudeMdPath, "utf-8");
  const startIndex = content.indexOf(MARKER_START);
  const endIndex = content.indexOf(MARKER_END);

  if (startIndex < 0 || endIndex < 0) return;

  const before = content.substring(0, startIndex).trimEnd();
  const after = content.substring(endIndex + MARKER_END.length).trimStart();
  content = before + (after ? "\n\n" + after : "") + "\n";

  writeFileSync(claudeMdPath, content);
  console.log("  Removed constraint block from CLAUDE.md");
}

function removeCommandFiles(targetPath: string): void {
  const commandsDir = join(targetPath, ".claude", "commands");
  if (!existsSync(commandsDir)) return;

  const commands = ["ccplan.md", "cconboard.md", "ccdebug.md"];
  let removed = 0;

  for (const file of commands) {
    const filePath = join(commandsDir, file);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, "utf-8");
        if (content.includes("AI Dev Companion")) {
          unlinkSync(filePath);
          removed++;
        }
      } catch {
        // skip files we can't read
      }
    }
  }

  if (removed > 0) {
    console.log(`  Removed ${removed} command file(s) from .claude/commands/`);
  }
}
