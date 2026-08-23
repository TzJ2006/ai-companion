#!/usr/bin/env npx tsx
import { resolve, join } from "node:path";
import { existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync, rmSync } from "node:fs";
import {
  loadRegistry,
  saveRegistry,
  removeTarget,
  normalizeTargetPath,
} from "./lib/registry.ts";

const MARKER_START = "<!-- AI-DEV-COMPANION:START -->";
const MARKER_END = "<!-- AI-DEV-COMPANION:END -->";

const args = process.argv.slice(2);

function printUsage(): void {
  console.log(`Usage: npx tsx scripts/uninstall.ts <target-path> [options]

Remove AI Dev Companion from a target project. This removes:
  - Hook entries from .claude/settings.json and .codex/hooks.json
  - Constraint block from CLAUDE.md
  - Claude command files and Codex .agents/skills adapters
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
  : [normalizeTargetPath(args[0])];

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
  removeCodexHooks(targetPath);
  removeHookWrappers(targetPath);
  removeConstraintBlockFromClaudeMd(targetPath);
  removeCommandFiles(targetPath);
  removeCodexSkills(targetPath);
  saveRegistry(removeTarget(registry, targetPath));

  console.log("  Done.");
}

function isCompanionHookEntry(entry: Record<string, unknown>): boolean {
  const blob = JSON.stringify(entry).replace(/\\/g, "/");
  return (
    blob.includes("aidev-hook.cjs") ||
    blob.includes("packages/hook/dist/") ||
    blob.includes("ai-companion")
  );
}

function removeHookWrappers(targetPath: string): void {
  for (const relative of [".claude/hooks/aidev-hook.cjs", ".codex/aidev-hook.cjs"]) {
    const filePath = join(targetPath, relative);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }
}

function removeCodexHooks(targetPath: string): void {
  const hooksPath = join(targetPath, ".codex", "hooks.json");
  if (!existsSync(hooksPath)) return;

  try {
    const settings = JSON.parse(readFileSync(hooksPath, "utf-8"));
    const hooks = settings.hooks;
    if (!hooks) return;
    for (const event of ["PostToolUse", "PreToolUse"]) {
      if (!Array.isArray(hooks[event])) continue;
      hooks[event] = hooks[event].filter(
        (entry: Record<string, unknown>) => !isCompanionHookEntry(entry)
      );
      if (hooks[event].length === 0) delete hooks[event];
    }
    writeFileSync(hooksPath, JSON.stringify(settings, null, 2) + "\n");
    console.log("  Removed hooks from .codex/hooks.json");
  } catch {
    console.log("  Warning: could not parse .codex/hooks.json");
  }
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
        (entry: Record<string, unknown>) => !isCompanionHookEntry(entry)
      );
      if (hooks.PostToolUse.length === 0) delete hooks.PostToolUse;
    }

    if (Array.isArray(hooks.PreToolUse)) {
      hooks.PreToolUse = hooks.PreToolUse.filter(
        (entry: Record<string, unknown>) => !isCompanionHookEntry(entry)
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

  const sourceDir = join(resolve(import.meta.dirname, ".."), ".claude", "commands");
  const commands = existsSync(sourceDir)
    ? readdirSync(sourceDir).filter((file) => file.endsWith(".md"))
    : [];
  let removed = 0;

  for (const file of commands) {
    const filePath = join(commandsDir, file);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, "utf-8");
        if (
          content.includes("skills/") ||
          content.includes("AI Dev Companion") ||
          content.includes("AI-DEV-COMPANION:ROOT")
        ) {
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

function removeCodexSkills(targetPath: string): void {
  const sourceDir = join(resolve(import.meta.dirname, ".."), ".agents", "skills");
  const skillsDir = join(targetPath, ".agents", "skills");
  if (!existsSync(sourceDir) || !existsSync(skillsDir)) return;

  let removed = 0;
  for (const name of readdirSync(sourceDir)) {
    const skillPath = join(skillsDir, name);
    const marker = join(skillPath, "SKILL.md");
    if (!existsSync(marker)) continue;
    try {
      if (readFileSync(marker, "utf-8").includes("AI Dev Companion Codex Adapter")) {
        rmSync(skillPath, { recursive: true, force: true });
        removed++;
      }
    } catch {
      // skip files we can't read
    }
  }
  if (removed > 0) {
    console.log(`  Removed ${removed} Codex skill adapter(s) from .agents/skills/`);
  }
}
