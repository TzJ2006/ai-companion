import { Command } from "commander";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { HistoryStore } from "@aidev/history";

// This file compiles to <companion>/packages/cli/dist/commands/install.js,
// so the ai-companion repo root is four directories up from here.
const COMPANION_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  ".."
).replace(/\\/g, "/");

// Bare markers — must match the convention already present in target repos so
// reinstalls UPDATE the block in place instead of appending a duplicate.
const CLAUDE_MD_START = "<!-- AI-DEV-COMPANION:START -->";
const CLAUDE_MD_END = "<!-- AI-DEV-COMPANION:END -->";

interface HookCommand {
  type: "command";
  command: string;
}
interface HookMatcherGroup {
  matcher: string;
  hooks: HookCommand[];
}
interface ClaudeSettings {
  hooks?: Record<string, HookMatcherGroup[]>;
  [key: string]: unknown;
}

// References to the ai-companion source tree inside the command files are
// written relative (skills/, packages/, scripts/). In a target repo those must
// point at the absolute ai-companion location. docs/ecl/, .devcompanion/ and
// .claude/ are intentionally left relative — they are target-local.
function rewriteCompanionPaths(content: string): string {
  return content.replace(
    /(?<![\w./-])(skills|packages|scripts)\//g,
    `${COMPANION_ROOT}/$1/`
  );
}

function buildConstraintsSection(): string {
  return `${CLAUDE_MD_START}
## AI Dev Companion

_Managed by \`aidev install\` — content inside this block is overwritten on reinstall._

This repository is wired to **AI Dev Companion** (installed from \`${COMPANION_ROOT}\`):
function-level change tracking plus a planning/execution skill pipeline.

**Workflow — prefer these over ad-hoc edits for non-trivial changes:**
\`/idea\` → \`/ccdiscuss\` (align) → \`/ccplan\` (plan; STOPS for approval) → \`/ccedit\`
(DAG execution) → \`/ccdebug\` (on failure). Use \`/cconboard\` to onboard existing code.

**Change tracking:** a PostToolUse hook records every \`.py\`/\`.ts\` edit at function
level (and \`.yaml\`/\`.md\` at file level) into \`.devcompanion/\`. Plans live in
\`docs/ecl/*.yaml\`.

**Feature guards:** if \`docs/ecl/*.yaml\` declares \`feature_guard\` key_files, preserve
their invariants when editing those files and run their verification afterward.
${CLAUDE_MD_END}`;
}

// Strip any existing companion hook (matching packages/hook/dist/<file>,
// regardless of \\ vs / path style or matcher group), then drop empty groups.
// This makes reinstall idempotent even against earlier backslash-path installs.
function removeCompanionHooks(
  hooks: Record<string, HookMatcherGroup[]>,
  event: string,
  fileName: string
): void {
  const groups = hooks[event];
  if (!groups) return;
  const needle = `packages/hook/dist/${fileName}`;
  for (const g of groups) {
    if (!g.hooks) continue;
    g.hooks = g.hooks.filter((h) => !h.command.replace(/\\/g, "/").includes(needle));
  }
  hooks[event] = groups.filter((g) => (g.hooks?.length ?? 0) > 0);
}

function addHook(
  hooks: Record<string, HookMatcherGroup[]>,
  event: string,
  matcher: string,
  command: string
): void {
  hooks[event] ??= [];
  let group = hooks[event].find((g) => g.matcher === matcher);
  if (!group) {
    group = { matcher, hooks: [] };
    hooks[event].push(group);
  }
  group.hooks ??= [];
  group.hooks.push({ type: "command", command });
}

function installHooks(targetRoot: string, enforce: boolean): string[] {
  const claudeDir = join(targetRoot, ".claude");
  mkdirSync(claudeDir, { recursive: true });
  const settingsPath = join(claudeDir, "settings.json");

  let settings: ClaudeSettings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as ClaudeSettings;
    } catch {
      settings = {};
    }
  }
  settings.hooks ??= {};

  const notes: string[] = [];

  // PostToolUse (core, always managed): remove any prior companion variant, set one canonical.
  removeCompanionHooks(settings.hooks, "PostToolUse", "index.js");
  addHook(settings.hooks, "PostToolUse", "Edit|Write", `node "${COMPANION_ROOT}/packages/hook/dist/index.js"`);
  notes.push("PostToolUse hook set (deduped to one canonical entry)");

  // PreToolUse (opt-in via --enforce). Only touched when the flag is set, so we
  // never silently remove a user's other PreToolUse hooks.
  if (enforce) {
    removeCompanionHooks(settings.hooks, "PreToolUse", "pre-tool-use.js");
    addHook(settings.hooks, "PreToolUse", "Edit|Write", `node "${COMPANION_ROOT}/packages/hook/dist/pre-tool-use.js"`);
    notes.push("PreToolUse (--enforce) hook set (deduped)");
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  return notes;
}

function installCommands(targetRoot: string): string[] {
  const srcDir = join(COMPANION_ROOT, ".claude", "commands");
  const dstDir = join(targetRoot, ".claude", "commands");
  mkdirSync(dstDir, { recursive: true });
  const copied: string[] = [];
  for (const file of readdirSync(srcDir).filter((f) => f.endsWith(".md"))) {
    const content = readFileSync(join(srcDir, file), "utf-8");
    writeFileSync(join(dstDir, file), rewriteCompanionPaths(content));
    copied.push(file);
  }
  return copied;
}

function installClaudeMd(targetRoot: string): string {
  const claudeMdPath = join(targetRoot, "CLAUDE.md");
  const section = buildConstraintsSection();
  if (!existsSync(claudeMdPath)) {
    writeFileSync(claudeMdPath, section + "\n");
    return "CLAUDE.md created with constraints section";
  }
  const existing = readFileSync(claudeMdPath, "utf-8");
  const start = existing.indexOf(CLAUDE_MD_START);
  const end = existing.indexOf(CLAUDE_MD_END);
  if (start !== -1 && end !== -1 && end > start) {
    const before = existing.slice(0, start);
    const after = existing.slice(end + CLAUDE_MD_END.length);
    writeFileSync(claudeMdPath, before + section + after);
    return "CLAUDE.md constraints section updated";
  }
  const sep = existing.endsWith("\n") ? "\n" : "\n\n";
  writeFileSync(claudeMdPath, existing + sep + section + "\n");
  return "CLAUDE.md constraints section appended";
}

async function installDevcompanion(targetRoot: string): Promise<void> {
  await new HistoryStore(targetRoot).init();
  mkdirSync(join(targetRoot, ".devcompanion", "queue"), { recursive: true });
  mkdirSync(join(targetRoot, "docs", "ecl"), { recursive: true });
}

export const installCommand = new Command("install")
  .description(
    "Install AI Dev Companion into a target repo (hook + commands + CLAUDE.md + .devcompanion). Idempotent: merges/updates if already present."
  )
  .option("-p, --project <path>", "Target project root path", ".")
  .option("--enforce", "Also inject the PreToolUse enforcement hook", false)
  .action(async (opts: { project: string; enforce: boolean }) => {
    const targetRoot = resolve(opts.project).replace(/\\/g, "/");

    if (targetRoot === COMPANION_ROOT) {
      console.error(
        "Refusing to install into the ai-companion source repo itself (it IS the companion)."
      );
      process.exitCode = 1;
      return;
    }
    if (!existsSync(targetRoot)) {
      console.error(`Target path does not exist: ${targetRoot}`);
      process.exitCode = 1;
      return;
    }

    console.log(`Installing AI Dev Companion into: ${targetRoot}`);
    console.log(`  Source (ai-companion): ${COMPANION_ROOT}`);

    await installDevcompanion(targetRoot);
    console.log("  .devcompanion/ initialized (reviews/, history/, queue/, index.json); docs/ecl/ created");

    for (const note of installHooks(targetRoot, opts.enforce)) {
      console.log(`  ${note}`);
    }

    const copied = installCommands(targetRoot);
    console.log(`  Copied ${copied.length} command(s) → .claude/commands/ (paths rewritten to absolute): ${copied.join(", ")}`);

    console.log(`  ${installClaudeMd(targetRoot)}`);

    console.log("Done.");
  });
