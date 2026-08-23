import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initDevcompanion } from "./init-devcompanion.ts";
import {
  applyManagedGitignore,
  visibilityToGitignoreProfile,
  type RepoVisibility,
} from "../../packages/history/src/managed-gitignore.ts";

const MARKER_START = "<!-- AI-DEV-COMPANION:START -->";
const MARKER_END = "<!-- AI-DEV-COMPANION:END -->";
const COMMAND_ROOT_MARKER = "<!-- AI-DEV-COMPANION:ROOT -->";

const CLAUDE_HOOK_WRAPPER = ".claude/hooks/aidev-hook.cjs";
const CODEX_HOOK_WRAPPER = ".codex/aidev-hook.cjs";

const COMPANION_ROOT_PREAMBLE = `${COMMAND_ROOT_MARKER}
Resolve companion root from \`$AIDEV_ROOT\` or \`aidev_root\` in \`~/.aidev-companion/registry.json\`. Skill specs, packages, and scripts below are under that root — not this repository.
`;

export interface InstallOptions {
  targetPath: string;
  aidevRoot: string;
  enforce: boolean;
  includeCommands: boolean;
  agent: "claude" | "codex" | "both";
  /** 3a: public-safe gitignore if omitted. */
  visibility?: RepoVisibility;
}

export interface InstallResult {
  settings_json_updated: boolean;
  claude_md_updated: boolean;
  commands_installed: string[];
  devcompanion_initialized: boolean;
  pre_tool_hook_installed: boolean;
  codex_hooks_updated: boolean;
  codex_skills_installed: string[];
  gitignore_updated: boolean;
}

export function installAgentConfig(options: InstallOptions): InstallResult {
  const {
    targetPath,
    aidevRoot,
    enforce,
    includeCommands,
    agent,
    visibility = "public",
  } = options;
  const result: InstallResult = {
    settings_json_updated: false,
    claude_md_updated: false,
    commands_installed: [],
    devcompanion_initialized: false,
    pre_tool_hook_installed: false,
    codex_hooks_updated: false,
    codex_skills_installed: [],
    gitignore_updated: false,
  };

  initDevcompanion(targetPath);
  result.devcompanion_initialized = true;

  // 3a — visibility-aware managed gitignore (replaces any previous managed block)
  result.gitignore_updated = installManagedGitignore(targetPath, visibility);

  if (agent === "claude" || agent === "both") {
    installHookWrapper(targetPath, aidevRoot, CLAUDE_HOOK_WRAPPER);
    result.settings_json_updated = installSettingsJson(targetPath, enforce);
    result.pre_tool_hook_installed = enforce;
    result.claude_md_updated = installClaudeMd(targetPath);
    if (includeCommands) {
      result.commands_installed = installCommands(targetPath, aidevRoot);
    }
  }

  if (agent === "codex" || agent === "both") {
    result.codex_hooks_updated = installCodexHooks(targetPath, enforce);
    installHookWrapper(targetPath, aidevRoot, CODEX_HOOK_WRAPPER);
    result.codex_skills_installed = installCodexSkills(targetPath, aidevRoot);
  }

  return result;
}

/** 3a */
function installManagedGitignore(targetPath: string, visibility: RepoVisibility): boolean {
  const gitignorePath = join(targetPath, ".gitignore");
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf-8") : "";
  const next = applyManagedGitignore(existing, visibilityToGitignoreProfile(visibility));
  if (next === existing) return false;
  writeFileSync(gitignorePath, next);
  return true;
}

/** 3b — copy the path-free hook wrapper (no aidevRoot baked in). */
function installHookWrapper(targetPath: string, aidevRoot: string, relativePath: string): void {
  const source = join(aidevRoot, "scripts", "lib", "aidev-hook.cjs");
  const fallback = join(dirname(fileURLToPath(import.meta.url)), "aidev-hook.cjs");
  const src = existsSync(source) ? source : fallback;
  const dest = join(targetPath, relativePath);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, readFileSync(src));
}

function claudeHookCommand(script = "index.js"): string {
  const extra = script === "index.js" ? "" : ` ${script}`;
  return `node "${CLAUDE_HOOK_WRAPPER}"${extra}`;
}

function codexHookCommand(script = "index.js"): string {
  const extra = script === "index.js" ? "" : ` ${script}`;
  return `node "${CODEX_HOOK_WRAPPER}"${extra}`;
}

export function isCompanionHookCommand(command: unknown): boolean {
  if (typeof command !== "string") return false;
  const normalized = command.replace(/\\/g, "/");
  return (
    normalized.includes("packages/hook/dist/") ||
    normalized.includes("aidev-hook.cjs") ||
    normalized.includes("ai-companion")
  );
}

function stripCompanionHookGroups(
  groups: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const kept: Array<Record<string, unknown>> = [];
  for (const group of groups) {
    if (isCompanionHookCommand(group.command)) continue;
    if (!Array.isArray(group.hooks)) {
      kept.push(group);
      continue;
    }
    const hooks = (group.hooks as Array<Record<string, unknown>>).filter(
      (hook) => !isCompanionHookCommand(hook.command)
    );
    if (hooks.length === 0) continue;
    kept.push({ ...group, hooks });
  }
  return kept;
}

function installCodexHooks(targetPath: string, enforce: boolean): boolean {
  const codexDir = join(targetPath, ".codex");
  // ponytail: mkdirSync throws EEXIST when .codex is a file — surface a clear fix
  if (existsSync(codexDir) && statSync(codexDir).isFile()) {
    throw new Error(
      `Cannot install: ${codexDir} exists as a file. Delete the file so .codex/ can be created as a directory.`
    );
  }
  mkdirSync(codexDir, { recursive: true });
  const hooksPath = join(codexDir, "hooks.json");
  let existing: Record<string, unknown> = {};
  if (existsSync(hooksPath)) {
    try {
      existing = JSON.parse(readFileSync(hooksPath, "utf-8")) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }

  const hooks = (existing.hooks ?? {}) as Record<string, Array<Record<string, unknown>>>;
  const installHook = (event: string, fileName: string): void => {
    const groups = hooks[event] ?? [];
    const retained = stripCompanionHookGroups(groups);
    const command = codexHookCommand(fileName);
    retained.push({
      matcher: "^apply_patch$",
      hooks: [{
        type: "command",
        command,
        commandWindows: command,
        timeout: 10,
      }],
    });
    hooks[event] = retained;
  };

  installHook("PostToolUse", "index.js");
  if (enforce) installHook("PreToolUse", "pre-tool-use.js");
  writeFileSync(hooksPath, JSON.stringify({ ...existing, hooks }, null, 2) + "\n");
  return true;
}

function portableCompanionBody(source: string): string {
  return source
    .replaceAll("../../../skills/", "$AIDEV_ROOT/skills/")
    .replace(/(?<![\w./-])(skills|packages|scripts)\//g, "$$AIDEV_ROOT/$1/");
}

function withCompanionRootPreamble(source: string): string {
  return `${COMPANION_ROOT_PREAMBLE}\n${portableCompanionBody(source)}`;
}

function installCodexSkills(targetPath: string, aidevRoot: string): string[] {
  const sourceDir = join(aidevRoot, ".agents", "skills");
  const targetDir = join(targetPath, ".agents", "skills");
  mkdirSync(targetDir, { recursive: true });
  const installed: string[] = [];
  if (!existsSync(sourceDir)) return installed;
  for (const name of readdirSync(sourceDir)) {
    const source = join(sourceDir, name, "SKILL.md");
    if (!existsSync(source)) continue;
    const destination = join(targetDir, name);
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, "SKILL.md"), withCompanionRootPreamble(readFileSync(source, "utf-8")));
    installed.push(name);
  }
  return installed;
}

function targetRepoPermissions(): { allow: string[]; deny: string[] } {
  // 3b: no parentDir/** grants — scope to the target repo only.
  return {
    allow: [
      "Read",
      "Glob",
      "Grep",
      "Edit",
      "Write",
      "Bash(git status *)",
      "Bash(git diff *)",
      "Bash(git log *)",
      "Bash(git branch *)",
      "Bash(git checkout *)",
      "Bash(git add *)",
      "Bash(git commit *)",
      "Bash(git stash *)",
      "Bash(git show *)",
      "Bash(git blame *)",
      "Bash(git fetch *)",
      "Bash(git pull *)",
      "Bash(git push)",
      "Bash(git push -u *)",
      "Bash(git push origin *)",
      "Bash(npm *)",
      "Bash(npx *)",
      "Bash(node *)",
      "Bash(python *)",
      "Bash(pip *)",
      "Bash(conda *)",
      "Bash(tsc *)",
      "Bash(tsx *)",
      "Bash(ls *)",
      "Bash(cat *)",
      "Bash(head *)",
      "Bash(tail *)",
      "Bash(wc *)",
      "Bash(find *)",
      "Bash(grep *)",
      "Bash(rg *)",
      "Bash(xargs *)",
      "Bash(echo *)",
      "Bash(mkdir *)",
      "Bash(cp *)",
      "Bash(mv *)",
      "Bash(touch *)",
      "Bash(pwd)",
      "Bash(which *)",
      "Bash(where *)",
      "Bash(cd *)",
      "Bash([ *)",
    ],
    deny: [
      "Bash(rm -rf *)",
      "Bash(rm -r *)",
      "Bash(rmdir *)",
      "Bash(del *)",
      "Bash(rd *)",
      "Bash(git push --force *)",
      "Bash(git push -f *)",
      "Bash(git reset --hard *)",
      "Bash(git clean -f *)",
      "Bash(format *)",
    ],
  };
}

function installSettingsJson(targetPath: string, enforce: boolean): boolean {
  const claudeDir = join(targetPath, ".claude");
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }

  const settingsPath = join(claudeDir, "settings.json");
  let existing: Record<string, unknown> = {};

  if (existsSync(settingsPath)) {
    try {
      existing = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      existing = {};
    }
  }

  const permissions = targetRepoPermissions();

  const hooks = (existing.hooks ?? {}) as Record<string, unknown[]>;
  let postToolUse = stripCompanionHookGroups(
    (hooks.PostToolUse ?? []) as Array<Record<string, unknown>>
  );
  let preToolUse = stripCompanionHookGroups(
    (hooks.PreToolUse ?? []) as Array<Record<string, unknown>>
  );

  const hookCommand = claudeHookCommand("index.js");
  const preHookCommand = claudeHookCommand("pre-tool-use.js");

  const postHookExists = postToolUse.some(
    (entry) =>
      entry.matcher === "Edit|Write" &&
      Array.isArray(entry.hooks) &&
      (entry.hooks as Array<Record<string, string>>).some((h) => h.command === hookCommand)
  );

  if (!postHookExists) {
    postToolUse.push({
      matcher: "Edit|Write",
      hooks: [{ type: "command", command: hookCommand }],
    });
  }

  if (enforce) {
    const preHookExists = preToolUse.some(
      (entry) =>
        entry.matcher === "Edit|Write|Bash" &&
        Array.isArray(entry.hooks) &&
        (entry.hooks as Array<Record<string, string>>).some((h) => h.command === preHookCommand)
    );

    if (!preHookExists) {
      preToolUse.push({
        // Bash included so the guard's destructive-command patterns can fire
        matcher: "Edit|Write|Bash",
        hooks: [{ type: "command", command: preHookCommand }],
      });
    }
  }

  hooks.PostToolUse = postToolUse;
  if (preToolUse.length > 0) {
    hooks.PreToolUse = preToolUse;
  }

  const merged = { ...existing, permissions, hooks };
  writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + "\n");
  return true;
}

function installClaudeMd(targetPath: string): boolean {
  const claudeMdPath = join(targetPath, "CLAUDE.md");
  let existing = "";

  if (existsSync(claudeMdPath)) {
    existing = readFileSync(claudeMdPath, "utf-8");
  }

  const constraintBlock = generateConstraintBlock();

  if (existing.includes(MARKER_START)) {
    const before = existing.substring(0, existing.indexOf(MARKER_START));
    const after = existing.substring(existing.indexOf(MARKER_END) + MARKER_END.length);
    const updated = before + constraintBlock + after;
    writeFileSync(claudeMdPath, updated);
  } else {
    const separator = existing.length > 0 ? "\n\n" : "";
    writeFileSync(claudeMdPath, existing + separator + constraintBlock);
  }

  return true;
}

function generateConstraintBlock(): string {
  return `${MARKER_START}
## AI Dev Companion — Constraints

This project is tracked by AI Dev Companion. The following rules are enforced:

### Mandatory Workflows

1. **All code changes are automatically recorded** via PostToolUse hook — every Edit/Write to tracked files is captured
2. **Before starting a feature**, use \`/ccplan\` to create an ECL plan in \`docs/ecl/\`
3. **Before editing guarded files**, check \`docs/ecl/*.yaml\` for active feature guards and preserve invariants
4. **After editing**, the hook records: timestamp, file, tool, ECL context automatically
5. **When tests fail**, use \`/ccdebug\` — fix code, not tests (max 3 retries)
6. **For codebase analysis**, use \`/cconboard\` to generate structured documentation

### Tracked File Extensions

Changes to \`.py\`, \`.pyi\`, \`.ts\`, \`.tsx\`, \`.mts\`, \`.cts\` files are tracked at function level.

### Storage Layout

- \`.devcompanion/queue/\` — event queue (hook writes here, daemon processes)
- \`.devcompanion/reviews/\` — processed review sessions (JSON)
- \`.devcompanion/history/\` — per-file change history (JSON)
- \`docs/ecl/\` — active feature constraints (YAML, committed to git)

### Feature Guard Protocol

When \`docs/ecl/*.yaml\` files contain \`feature_guard\` sections:
- Before editing a guarded file, announce which invariants must be preserved
- After editing, run the guard's verification command
- If verification fails, revert and investigate — do not proceed with broken guards

### AI Dev Companion Location

Companion root is resolved at runtime from \`$AIDEV_ROOT\` or from \`aidev_root\` in \`~/.aidev-companion/registry.json\`. Do not put machine-local install paths in committed files.
${MARKER_END}`;
}

function installCommands(targetPath: string, aidevRoot: string): string[] {
  const sourceDir = join(aidevRoot, ".claude", "commands");
  const commandsDir = join(targetPath, ".claude", "commands");
  mkdirSync(commandsDir, { recursive: true });
  const installed: string[] = [];
  if (!existsSync(sourceDir)) return installed;

  for (const file of readdirSync(sourceDir).filter((name) => name.endsWith(".md"))) {
    const content = withCompanionRootPreamble(readFileSync(join(sourceDir, file), "utf-8"));
    writeFileSync(join(commandsDir, file), content);
    installed.push(file.replace(/\.md$/, ""));
  }
  return installed;
}
