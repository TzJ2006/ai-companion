#!/usr/bin/env tsx
// I-098 — install the shared base into any repository: the single-file
// artifact, the three hook wirings, the five shared skills, and a graph seed.
// The skeleton is inherited from the original claude-companion installer —
// CRLF-normalised byte comparison for staleness, merge-never-clobber for
// other people's hooks, an idempotent re-install — with two upgrades:
//   * what gets copied is the BUNDLE, not a pointer to this checkout, so the
//     target works when this machine is gone (D34; the old absolute-path
//     wiring died on any other machine — silently, and silently means OPEN);
//   * a smoke test runs at the end of every install: the docs say a hook
//     whose path is wrong is a NON-blocking error, so "did the guard actually
//     answer exit 2" is verified on the spot, never assumed.
// Registry functions take an explicit path so tests inject a temp registry —
// the old suite wrote its temp dirs into the real install list.

import {
  mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, copyFileSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { claudeHooks, cursorHooks, codexHooks, ENGINE_RELATIVE } from "./manifests.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REGISTRY = join(HERE, ".installs.json");

const normEol = (text: string) => text.replaceAll("\r\n", "\n");

/** Every file the installer wholly owns inside a target repo. */
function ownedFiles(): { src: string; rel: string }[] {
  const out = [
    { src: join(HERE, "dist", "companion.mjs"), rel: ENGINE_RELATIVE },
    { src: join(HERE, "FORMAT.md"), rel: ".claude/companion/FORMAT.md" },
  ];
  for (const name of readdirSync(join(HERE, "skills"))) {
    // .agents/skills serves Cursor and Codex natively; .claude/skills is the
    // Claude Code bridge. Copies, not symlinks: git on Windows checks out
    // symlinks as text files unless Developer Mode is on, and a silently
    // broken skill is worse than two identical files kept fresh by --update.
    out.push({ src: join(HERE, "skills", name, "SKILL.md"), rel: `.agents/skills/${name}/SKILL.md` });
    out.push({ src: join(HERE, "skills", name, "SKILL.md"), rel: `.claude/skills/${name}/SKILL.md` });
  }
  return out;
}

const GRAPH_SEED = `version: 1
project: PROJECT_NAME
overview: >
  一段话说清这个项目在做什么。

# 终点：什么叫"这个项目做完了"。每个都是下面某个想法的 id。
endpoints: []

ideas: []
`;

const GITIGNORE_SEED = `graph.html
.approved
.scan-todo
.scan-done
.runtime/
changes.json
`;

export interface InstallResult { target: string; installed: string[]; smoke: "pass" | "fail" }

export function install(targetDir: string, opts: { registryPath?: string } = {}): InstallResult {
  const target = resolve(targetDir);
  if (!existsSync(target)) throw new Error(`目标不存在：${target}`);
  if (!existsSync(join(HERE, "dist", "companion.mjs"))) {
    throw new Error("先构建产物：node companion/build.mjs（安装的是单文件产物，不是源码指针）");
  }
  const installed: string[] = [];

  for (const { src, rel } of ownedFiles()) {
    const dest = join(target, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    installed.push(rel);
  }

  mergeClaudeSettings(target);
  mergeJsonHooks(join(target, ".cursor", "hooks.json"), cursorHooks());
  mergeJsonHooks(join(target, ".codex", "hooks.json"), codexHooks());
  installed.push(".claude/settings.json", ".cursor/hooks.json", ".codex/hooks.json");

  // Seed the ledger, never clobber it.
  const graph = join(target, "ideas", "graph.yaml");
  if (!existsSync(graph)) {
    mkdirSync(dirname(graph), { recursive: true });
    writeFileSync(graph, GRAPH_SEED.replace("PROJECT_NAME", target.split(/[\\/]/).pop() ?? "project"));
    installed.push("ideas/graph.yaml");
  }
  const gitignore = join(target, "ideas", ".gitignore");
  if (!existsSync(gitignore)) {
    writeFileSync(gitignore, GITIGNORE_SEED);
    installed.push("ideas/.gitignore");
  }

  // The on-the-spot proof: pipe a violating write into the just-installed
  // guard and demand exit code 2. A wrong path would exit 0 — silently open.
  const probe = spawnSync("node", [join(target, ENGINE_RELATIVE), "guard", "--platform=claude"], {
    input: JSON.stringify({
      hook_event_name: "PreToolUse", tool_name: "Write",
      tool_input: { file_path: join(target, "src", "__companion_smoke__.ts"), content: "x" },
      cwd: target,
    }),
    encoding: "utf8", timeout: 60_000,
  });
  const smoke = probe.status === 2 ? "pass" as const : "fail" as const;
  if (smoke === "fail") {
    throw new Error(`安装后的守卫冒烟没通过（退出码 ${probe.status}，期望 2）—— 接线有问题，不能当装好了。\n${probe.stdout}${probe.stderr}`);
  }

  remember(target, opts.registryPath ?? DEFAULT_REGISTRY);
  return { target, installed, smoke };
}

/** Merge our hook groups into .claude/settings.json without touching anyone else's. */
function mergeClaudeSettings(target: string): void {
  const file = join(target, ".claude", "settings.json");
  mkdirSync(dirname(file), { recursive: true });
  let settings: { hooks?: Record<string, unknown[]> } = {};
  if (existsSync(file)) {
    try { settings = JSON.parse(readFileSync(file, "utf8")); } catch { settings = {}; }
  }
  settings.hooks ??= {};
  for (const [event, groups] of Object.entries(claudeHooks())) {
    const existing = (settings.hooks[event] ?? []) as unknown[];
    // Strip our own previous entries first, so a re-install replaces instead
    // of accumulating — and leaves every foreign entry exactly where it was.
    const foreign = existing.filter((g) => !JSON.stringify(g).includes(ENGINE_RELATIVE));
    settings.hooks[event] = [...foreign, ...groups];
  }
  writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
}

/** Same merge discipline for the Cursor/Codex hooks.json shapes. */
function mergeJsonHooks(file: string, manifest: { version?: number; hooks: Record<string, unknown[]> }): void {
  mkdirSync(dirname(file), { recursive: true });
  let current: { version?: number; hooks?: Record<string, unknown[]> } = {};
  if (existsSync(file)) {
    try { current = JSON.parse(readFileSync(file, "utf8")); } catch { current = {}; }
  }
  if (manifest.version !== undefined) current.version ??= manifest.version;
  current.hooks ??= {};
  for (const [event, entries] of Object.entries(manifest.hooks)) {
    const existing = (current.hooks[event] ?? []) as unknown[];
    const foreign = existing.filter((e) => !JSON.stringify(e).includes(ENGINE_RELATIVE));
    current.hooks[event] = [...foreign, ...entries];
  }
  writeFileSync(file, JSON.stringify(current, null, 2) + "\n");
}

// ─── registry, status, update ───────────────────────────────────────────────

function readRegistry(registryPath: string): string[] {
  if (!existsSync(registryPath)) return [];
  try { return JSON.parse(readFileSync(registryPath, "utf8")) as string[]; } catch { return []; }
}

function remember(target: string, registryPath: string): void {
  const entries = new Set(readRegistry(registryPath));
  entries.add(target.replaceAll("\\", "/"));
  mkdirSync(dirname(registryPath), { recursive: true });
  writeFileSync(registryPath, JSON.stringify([...entries].sort(), null, 2) + "\n");
}

export interface FileStatus { rel: string; state: "current" | "stale" | "missing" }

/** Byte-for-byte after CRLF normalisation — Windows git checks out CRLF, we write LF. */
export function statusOf(targetDir: string): FileStatus[] {
  const target = resolve(targetDir);
  return ownedFiles().map(({ src, rel }) => {
    const dest = join(target, rel);
    if (!existsSync(dest)) return { rel, state: "missing" as const };
    const same = normEol(readFileSync(src, "utf8")) === normEol(readFileSync(dest, "utf8"));
    return { rel, state: same ? "current" as const : "stale" as const };
  });
}

export function updateAll(registryPath: string): { target: string; refreshed: string[] }[] {
  const out: { target: string; refreshed: string[] }[] = [];
  for (const target of readRegistry(registryPath)) {
    if (!existsSync(target)) continue;                 // moved or deleted — skip, never invent
    const refreshed: string[] = [];
    for (const status of statusOf(target)) {
      if (status.state === "current") continue;
      const source = ownedFiles().find((f) => f.rel === status.rel)!;
      mkdirSync(dirname(join(target, status.rel)), { recursive: true });
      copyFileSync(source.src, join(target, status.rel));
      refreshed.push(status.rel);
    }
    out.push({ target, refreshed });
  }
  return out;
}

// ─── cli ────────────────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith("install.ts")) {
  const args = process.argv.slice(2);
  const registryPath = args.includes("--registry")
    ? args[args.indexOf("--registry") + 1] : DEFAULT_REGISTRY;
  try {
    if (args.includes("--status")) {
      for (const target of readRegistry(registryPath)) {
        if (!existsSync(target)) { console.log(`${target}  (目录不存在，跳过)`); continue; }
        const stale = statusOf(target).filter((f) => f.state !== "current");
        console.log(stale.length === 0 ? `${target}  全部最新`
          : `${target}\n${stale.map((f) => `  ${f.state}  ${f.rel}`).join("\n")}`);
      }
    } else if (args.includes("--update")) {
      for (const { target, refreshed } of updateAll(registryPath)) {
        console.log(refreshed.length === 0 ? `${target}  已是最新` : `${target}  刷新 ${refreshed.length} 个文件`);
      }
    } else if (args[0] && !args[0].startsWith("--")) {
      const result = install(args[0], { registryPath });
      console.log(`装进 ${result.target}：${result.installed.length} 处，守卫冒烟 ${result.smoke}`);
      console.log(`三家接线就位（.claude/settings.json、.cursor/hooks.json、.codex/hooks.json）。`);
      console.log(`Codex 一次性步骤：在 Codex 里跑 /hooks 审阅并信任这几条 hook。`);
      console.log(`下一步：在目标仓库里用 /ccscan 建图，或 migrate 迁旧图。`);
    } else {
      console.error("usage: install.ts <目标仓库> | --status | --update   [--registry <path>]");
      process.exit(2);
    }
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(1);
  }
}
