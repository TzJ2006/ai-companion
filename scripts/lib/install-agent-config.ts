import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { initDevcompanion } from "./init-devcompanion.ts";

const MARKER_START = "<!-- AI-DEV-COMPANION:START -->";
const MARKER_END = "<!-- AI-DEV-COMPANION:END -->";

export interface InstallOptions {
  targetPath: string;
  aidevRoot: string;
  enforce: boolean;
  includeCommands: boolean;
  agent: "claude" | "codex" | "both";
}

export interface InstallResult {
  settings_json_updated: boolean;
  claude_md_updated: boolean;
  commands_installed: string[];
  devcompanion_initialized: boolean;
  pre_tool_hook_installed: boolean;
  codex_hooks_updated: boolean;
  codex_skills_installed: string[];
}

export function installAgentConfig(options: InstallOptions): InstallResult {
  const { targetPath, aidevRoot, enforce, includeCommands, agent } = options;
  const result: InstallResult = {
    settings_json_updated: false,
    claude_md_updated: false,
    commands_installed: [],
    devcompanion_initialized: false,
    pre_tool_hook_installed: false,
    codex_hooks_updated: false,
    codex_skills_installed: [],
  };

  initDevcompanion(targetPath);
  result.devcompanion_initialized = true;

  if (agent === "claude" || agent === "both") {
    result.settings_json_updated = installSettingsJson(targetPath, aidevRoot, enforce);
    result.pre_tool_hook_installed = enforce;
    result.claude_md_updated = installClaudeMd(targetPath, aidevRoot);
    if (includeCommands) {
      result.commands_installed = installCommands(targetPath, aidevRoot);
    }
  }

  if (agent === "codex" || agent === "both") {
    result.codex_hooks_updated = installCodexHooks(targetPath, aidevRoot, enforce);
    result.codex_skills_installed = installCodexSkills(targetPath, aidevRoot);
  }

  return result;
}

function installCodexHooks(targetPath: string, aidevRoot: string, enforce: boolean): boolean {
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
    const needle = `packages/hook/dist/${fileName}`;
    const retained = groups.map((group) => ({
      ...group,
      hooks: Array.isArray(group.hooks)
        ? (group.hooks as Array<Record<string, unknown>>).filter((hook) =>
          typeof hook.command !== "string" || !hook.command.replace(/\\/g, "/").includes(needle)
        )
        : [],
    })).filter((group) => Array.isArray(group.hooks) && group.hooks.length > 0);
    retained.push({
      matcher: "^apply_patch$",
      hooks: [{
        type: "command",
        command: `node "${aidevRoot.replace(/\\/g, "/")}/packages/hook/dist/${fileName}"`,
        commandWindows: `node "${aidevRoot.replace(/\\/g, "/")}/packages/hook/dist/${fileName}"`,
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

function installCodexSkills(targetPath: string, aidevRoot: string): string[] {
  const sourceDir = join(aidevRoot, ".agents", "skills");
  const targetDir = join(targetPath, ".agents", "skills");
  mkdirSync(targetDir, { recursive: true });
  const installed: string[] = [];
  for (const name of readdirSync(sourceDir)) {
    const source = join(sourceDir, name, "SKILL.md");
    if (!existsSync(source)) continue;
    const destination = join(targetDir, name);
    mkdirSync(destination, { recursive: true });
    const content = readFileSync(source, "utf-8")
      .replaceAll("../../../skills/", `${aidevRoot.replace(/\\/g, "/")}/skills/`);
    writeFileSync(join(destination, "SKILL.md"), content);
    installed.push(name);
  }
  return installed;
}

function installSettingsJson(targetPath: string, aidevRoot: string, enforce: boolean): boolean {
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

  const parentDir = resolve(targetPath, "..");

  const permissions = {
    allow: [
      "Read",
      "Glob",
      "Grep",
      `Read(${parentDir}/**)`,
      `Glob(${parentDir}/**)`,
      `Grep(${parentDir}/**)`,
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

  const hooks = (existing.hooks ?? {}) as Record<string, unknown[]>;
  let postToolUse = (hooks.PostToolUse ?? []) as Array<Record<string, unknown>>;
  let preToolUse = (hooks.PreToolUse ?? []) as Array<Record<string, unknown>>;

  const hookCommand = `node "${join(aidevRoot, "packages/hook/dist/index.js")}"`;
  const preHookCommand = `node "${join(aidevRoot, "packages/hook/dist/pre-tool-use.js")}"`;

  postToolUse = postToolUse.filter(
    (entry) => !(entry.matcher === "Edit|Write" && typeof entry.command === "string" && (entry.command as string).includes("ai-companion"))
  );
  preToolUse = preToolUse.filter(
    (entry) => !(entry.matcher === "Edit|Write" && typeof entry.command === "string" && (entry.command as string).includes("ai-companion"))
  );

  const postHookExists = postToolUse.some(
    (entry) => entry.matcher === "Edit|Write" && Array.isArray(entry.hooks) &&
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
      (entry) => entry.matcher === "Edit|Write" && Array.isArray(entry.hooks) &&
        (entry.hooks as Array<Record<string, string>>).some((h) => h.command === preHookCommand)
    );

    if (!preHookExists) {
      preToolUse.push({
        matcher: "Edit|Write",
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

function installClaudeMd(targetPath: string, aidevRoot: string): boolean {
  const claudeMdPath = join(targetPath, "CLAUDE.md");
  let existing = "";

  if (existsSync(claudeMdPath)) {
    existing = readFileSync(claudeMdPath, "utf-8");
  }

  const constraintBlock = generateConstraintBlock(aidevRoot);

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

function generateConstraintBlock(aidevRoot: string): string {
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

- Install root: \`${aidevRoot}\`
- Hook: \`${aidevRoot}/packages/hook/dist/index.js\`
- Skills: \`${aidevRoot}/skills/\`
${MARKER_END}`;
}

function installCommands(targetPath: string, aidevRoot: string): string[] {
  const sourceDir = join(aidevRoot, ".claude", "commands");
  const commandsDir = join(targetPath, ".claude", "commands");
  mkdirSync(commandsDir, { recursive: true });
  const installed: string[] = [];

  for (const file of readdirSync(sourceDir).filter((name) => name.endsWith(".md"))) {
    const content = readFileSync(join(sourceDir, file), "utf-8").replace(
      /(?<![\w./-])(skills|packages|scripts)\//g,
      `${aidevRoot.replace(/\\/g, "/")}/$1/`
    );
    writeFileSync(join(commandsDir, file), content);
    installed.push(file.replace(/\.md$/, ""));
  }
  return installed;
}
