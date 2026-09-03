#!/usr/bin/env tsx
// I-098 — install the shared base into any repository: the single-file
// artifact, the three hook wirings, the five shared skills, and a graph seed.
// The skeleton is inherited from the original claude-companion installer —
// CRLF-normalised byte comparison for staleness, merge-never-clobber for
// other people's hooks, an idempotent re-install — with two upgrades:
//   * what gets copied is the BUNDLE, not a pointer to this checkout, so the
//     target works when this machine is gone (D34; the old absolute-path
//     wiring died on any other machine — silently, and silently means OPEN);
//   * a smoke test runs on every install, BEFORE the three hosts are wired:
//     the docs say a hook whose path is wrong is a NON-blocking error, so "did
//     the guard actually answer exit 2" is verified on the spot, never assumed
//     — and a guard that does not answer must never end up wired (D34/D15).
// And two things this installer will NOT do. It will not write over a file it
// could not read: every merge below is a read-modify-write, and treating an
// unparseable file as `{}` would rewrite it with our hooks alone — silently
// deleting a human's permissions.deny list (D34/D30, see refuseToClobber).
// And it will not quietly install BESIDE a previous generation's wiring: that
// leaves two guards on every event reading two different graphs (D34/D15, see
// findLegacyWiring). Nor ONTO a previous generation's GRAPH: `ideas/graph.yaml`
// can itself be a retired implementation's file (D10/H15, see the preflight in
// install) — wiring three hosts at a graph that does not describe the project
// makes every verdict, refusal and pass alike, meaningless.
// Replacing legacy wiring needs an explicit --replace-legacy;
// --dry-run shows what either path would touch; --uninstall is the inverse.
// Registry functions take an explicit path so tests inject a temp registry —
// the old suite wrote its temp dirs into the real install list.

import {
  mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, copyFileSync,
  rmSync, rmdirSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  claudeHooks, cursorHooks, codexHooks, ENGINE_RELATIVE, ENGINE_DIR, ENGINE_MARKER,
} from "./manifests.js";
// What counts as a legacy graph is the ENGINE's knowledge (suffixed names, the
// Codex node directory, and a bare graph stamped `agent:`), so the seed below
// asks it rather than recognising one filename of its own — see seedWouldLockOut.
import { findLegacySources, type LegacySource } from "./ideas.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REGISTRY = join(HERE, ".installs.json");

/** companion/build.mjs bundles the artifact with esbuild target "node20". */
const NODE_MINIMUM = 20;

const normEol = (text: string) => text.replaceAll("\r\n", "\n");

const refuseToClobber = (file: string, why: string) => new Error(
  `安装中止：读不懂已有文件 ${file} —— ${why}。\n`
  + `装下去会把它整个覆盖写回，里面原有的内容就没了`
  + `（在 .claude/settings.json 里，那是人手写的、禁掉 rm -rf 和 force push 的 permissions.deny 名单）。\n`
  + `请先把它修成合法 JSON，或者挪走再装。`);

/**
 * Read a JSON file that we are about to merge into and write back over.
 * A file we could not parse is NEVER treated as empty: continuing would rewrite
 * it with our own content alone and silently destroy whatever it held. Abort
 * naming the file instead, and let the human fix or move it — D34 (安装缺前置
 * 就明确失败，不静默降级) and D30 (静默 last-writer-wins 会丢人写的东西).
 * A whitespace-only file holds nothing, so it counts as absent, not as broken.
 */
function readJsonBeforeOverwrite(file: string, wanted: "object" | "array"): unknown {
  if (!existsSync(file)) return undefined;
  const raw = readFileSync(file, "utf8");
  if (raw.trim() === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw refuseToClobber(file, `不是合法 JSON（${error instanceof Error ? error.message : error}）`);
  }
  // Valid JSON of the wrong shape is the same hazard: `[...]` or `"x"` would be
  // dropped just as completely by the write-back below.
  const ok = wanted === "array"
    ? Array.isArray(parsed)
    : parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
  if (!ok) throw refuseToClobber(file, `顶层不是${wanted === "array" ? "数组" : "对象"}`);
  return parsed;
}

/** Every file the installer wholly owns inside a target repo. */
function ownedFiles(): { src: string; rel: string }[] {
  const out = [
    { src: join(HERE, "dist", "companion.mjs"), rel: ENGINE_RELATIVE },
    // The spec ships NEXT TO the engine — the skills say "读引擎旁边的
    // FORMAT.md" — so it follows the one engine constant wherever that points.
    { src: join(HERE, "FORMAT.md"), rel: `${ENGINE_DIR}/FORMAT.md` },
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

/** The three host configs this installer merges into — and reads before it does. */
function hostConfigs(target: string): string[] {
  return [
    join(target, ".claude", "settings.json"),
    join(target, ".cursor", "hooks.json"),
    join(target, ".codex", "hooks.json"),
  ];
}

/**
 * Every command line inside a hook entry, whatever the host's shape: Claude
 * splits it into `command` + `args`, Cursor and Codex put the whole line in
 * `command`. One string per entry is what both the legacy scan and the
 * --dry-run listing need, and neither should have to know the three shapes.
 */
function describeEntry(entry: unknown): string {
  const lines: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { for (const item of node) walk(item); return; }
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (typeof record.command === "string") {
      lines.push([record.command, ...(Array.isArray(record.args) ? record.args : [])].join(" "));
    }
    for (const value of Object.values(record)) walk(value);
  };
  walk(entry);
  return lines.join(" | ") || JSON.stringify(entry);
}

/**
 * The wirings of the three pre-unification implementations. Each one runs a
 * DIFFERENT engine off a DIFFERENT graph, so leaving one beside today's wiring
 * puts two guards on every event — and every output of a guard is "deny", so
 * two disagreeing guards mean either a refusal nobody can explain or, worse, a
 * write that should have been stopped going through (D15). That is a missing
 * prerequisite, and D34 says a missing prerequisite fails loudly rather than
 * degrading in silence: refuse, name the entries, and make the human write
 * --replace-legacy. Matched on the script each entry runs, never on the
 * directory it sits in — `.cursor/hooks/format.sh` is the example in Cursor's
 * own documentation and belongs to whoever put it there.
 */
const LEGACY_WIRINGS: { what: string; pattern: RegExp }[] = [
  { what: "claude-companion 的旧守卫", pattern: /claude-companion[\\/]+guard\.ts/ },
  { what: "cursor-companion 的旧闸门", pattern: /cursor-companion|hooks[\\/]+(gate|record|session)\.mjs/ },
  { what: "codex-companion 的旧钩子", pattern: /codex-companion|scripts[\\/]+companion\.py/ },
];

/** Which previous generation an entry belongs to, or undefined if it is not ours to touch. */
function legacyMatch(entry: unknown): string | undefined {
  const text = describeEntry(entry);
  return LEGACY_WIRINGS.find((w) => w.pattern.test(text))?.what;
}

export interface LegacyHit { file: string; event: string; what: string; entry: string }

/** Preflight: every pre-unification hook still wired up in the target repository. */
export function findLegacyWiring(targetDir: string): LegacyHit[] {
  const target = resolve(targetDir);
  const hits: LegacyHit[] = [];
  for (const file of hostConfigs(target)) {
    const parsed = readJsonBeforeOverwrite(file, "object") as
      { hooks?: Record<string, unknown[]> } | undefined;
    const hooks = parsed?.hooks;
    if (hooks === undefined || hooks === null || typeof hooks !== "object") continue;
    for (const [event, entries] of Object.entries(hooks)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const what = legacyMatch(entry);
        if (what !== undefined) hits.push({ file, event, what, entry: describeEntry(entry) });
      }
    }
  }
  return hits;
}

const showHit = (hit: LegacyHit) => `  ${hit.file}  ${hit.event}  ${hit.entry}   ←  ${hit.what}`;

const refuseLegacy = (hits: LegacyHit[]) => new Error(
  `安装中止：目标仓库里还留着上一代的接线，装下去每个事件会挂两个守卫。\n`
  + hits.map(showHit).join("\n")
  + `\n两个守卫读的不是同一张图：谁先答谁算数，人看到的要么是一次讲不出道理的拒绝，`
  + `要么是更糟的 —— 一次本该拦住的放行。\n`
  + `确认要换掉：加 --replace-legacy 重来，只删上面这几条，别人的 hook 一条不动。\n`
  + `想先看看会动什么：加 --dry-run，一个字节都不写。`);

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

/**
 * The ledger's ignore list, REPAIRED in place — created when absent, topped up
 * when it is merely out of date. Writing it only when the file was missing is
 * how a line added here never reaches a repository installed before it existed
 * (H14): today that is `.runtime/` and `changes.json`, i.e. the machine-local
 * approval receipts and test evidence the CLI alone may produce (D24) get
 * committed and start colliding on merge. Appending is the whole discipline —
 * every line the human wrote, comments included, stays exactly where it is, and
 * a line already there is not written twice (`.runtime` and `.runtime/` are the
 * same rule to git, so they are the same line to us).
 */
function repairIdeasIgnore(target: string, dryRun: boolean): boolean {
  const file = join(target, "ideas", ".gitignore");
  const bare = (line: string) => line.trim().replace(/\/+$/, "");
  if (!existsSync(file)) {
    // Its own mkdir: the graph seed above used to be the thing that created
    // ideas/, and skipping that seed (H13) must not turn this into ENOENT.
    if (!dryRun) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, GITIGNORE_SEED);
    }
    return true;
  }
  const current = normEol(readFileSync(file, "utf8"));
  const have = new Set(current.split("\n").map(bare));
  const missing = GITIGNORE_SEED.split("\n").filter((l) => l !== "" && !have.has(bare(l)));
  if (missing.length === 0) return false;
  if (!dryRun) {
    const gap = current === "" || current.endsWith("\n") ? "" : "\n";
    writeFileSync(file, `${current}${gap}${missing.join("\n")}\n`);
  }
  return true;
}

export interface InstallOptions {
  registryPath?: string;
  /** Remove the previous generation's hook entries instead of refusing to install. */
  replaceLegacy?: boolean;
  /** Work the whole plan out and write nothing — files, hooks, registry, all untouched. */
  dryRun?: boolean;
}

export interface InstallResult {
  target: string;
  installed: string[];
  /** "skipped" on a dry run: nothing was installed, so there is nothing to smoke. */
  smoke: "pass" | "fail" | "skipped";
  hooksAdded: string[];
  hooksRemoved: string[];
  legacy: LegacyHit[];
  /** H13 — set when the graph seed was deliberately NOT written because legacy
   *  graphs are still waiting to be migrated: the lines the human needs. */
  seedSkipped?: string;
  /** H15/D10 — set when `ideas/graph.yaml` is ITSELF a legacy graph: the lines
   *  the human needs. A real install refuses; --dry-run reports it instead. */
  canonicalLegacy?: string;
}

/**
 * H13/D10 — a repository whose old graph has not been migrated yet must NOT be
 * seeded. `migrate` refuses the moment `ideas/graph.yaml` exists, so the empty
 * graph written here would lock the old one out permanently — five of the six
 * repositories this installer has already touched sit exactly like that, a
 * `graph.claude.yaml` beside a bare seed nobody can merge into. So leave the
 * seat free, name what is waiting, and say which command fills it. The install
 * itself carries on: the guard denies while no graph exists (D16), which is the
 * right answer for a repository that has not decided on its graph yet.
 */
function seedWouldLockOut(sources: LegacySource[]): string {
  const pick = sources.length > 1 ? ` --pick ${sources.map((s) => s.kind).join("|")}` : "";
  return `没有种 ideas/graph.yaml：目标仓库里还留着没迁的旧图。\n`
    + sources.map((s) => `  ${s.kind}  ${s.path}${s.instruction === undefined ? "" : `\n    ${s.instruction}`}`).join("\n")
    + `\n种下去就再也迁不进来了 —— migrate 见到 ideas/graph.yaml 就拒绝，旧图会被永久锁在门外。\n`
    + `请在目标仓库里跑：node ${ENGINE_RELATIVE} migrate${pick}（先加 --dry-run 看一眼会迁出什么）。\n`
    + `确认这些旧图不要了：把它们挪走再重装，那时才会种一张空图。`;
}

/**
 * H15/D10 — the canonical name is OCCUPIED by a retired implementation's graph.
 * Detecting this is the engine's job (`agent:` / `enforce:` / `exempt:` stamps),
 * and it already answers with the one sentence naming the human step, so the
 * only thing left is to ASK — every time, not just when the seat looks empty.
 * Installing on top of such a file is worse than installing without a graph:
 * the three hosts all end up pointing at ideas/graph.yaml, and the guard judges
 * every write against a graph describing some other project's work. A missing
 * prerequisite fails loudly (D34), and this one cannot be fixed by us — the
 * rename is a decision about a live file, so name it and stop.
 */
function canonicalGraphIsLegacy(source: LegacySource): string {
  return `ideas/graph.yaml 不是这个项目的图，是上一代实现留下的：\n`
    + `  ${source.kind}  ${source.path}\n`
    + `  ${source.instruction}\n`
    + `装下去三家的守卫都会照着它判每一次写 —— 它描述的不是这个项目在做的事，`
    + `拦下的和放行的都不作数（D10）。`;
}

const refuseCanonicalLegacy = (source: LegacySource) => new Error(
  `安装中止：${canonicalGraphIsLegacy(source)}\n`
  + `请按上面那一句先改名、再 migrate，然后重装（引擎不替人改名，安装器也不动这个文件）。\n`
  + `想先看看会动什么：加 --dry-run，一个字节都不写。目标仓库现在一个字节都没动。`);

/**
 * D34 — 安装时先检查 Node，缺失就明确失败，不静默降级。
 * This process is obviously running under a Node, which proves nothing: all
 * three hosts run the guard as `node <engine> guard …`, resolved off PATH in
 * whatever environment the editor launches hooks in. A `node` that is missing
 * there is not a hook that merely misbehaves — Codex counts a failed hook as
 * NON-blocking, so every write proceeds unguarded (D15). So probe the same
 * `node` the hooks will get, and refuse before one byte is written.
 */
function requireNodeOnPath(): void {
  const probe = spawnSync("node", ["--version"], { encoding: "utf8", timeout: 30_000 });
  if (probe.error !== undefined || probe.status !== 0) {
    throw new Error(
      `安装中止：PATH 上找不到能跑的 node —— 三家的 hook 都是 \`node ${ENGINE_RELATIVE} guard …\`，没有 node 一条也起不来。\n`
      + `起不来的 hook 在 Codex 上算非阻塞，等于每次写都没人守；在 Cursor 上 failClosed 会把整个仓库拒死。\n`
      + `请先装 Node ${NODE_MINIMUM} 或更新的版本，再重新安装。目标仓库一个字节都没动。`);
  }
  // An unrecognisable version string is left alone on purpose: a working node
  // that merely names itself oddly must not block an install, and the smoke
  // probe below is the thing that actually decides whether it runs our bundle.
  const major = Number(/^v(\d+)\./.exec(probe.stdout.trim())?.[1]);
  if (Number.isFinite(major) && major < NODE_MINIMUM) {
    throw new Error(
      `安装中止：PATH 上的 node 太旧（${probe.stdout.trim()}，至少要 v${NODE_MINIMUM}）。\n`
      + `单文件产物是按 node${NODE_MINIMUM} 打的，旧版本会在跑到一半时报语法错 —— 那就是一个答不出话的守卫。\n`
      + `请升级 Node 再重新安装。目标仓库一个字节都没动。`);
  }
}

/**
 * The on-the-spot proof: pipe a violating write into the just-copied engine and
 * demand exit code 2. A wrong path would exit 0 — silently open.
 * It runs BEFORE any host config is merged (D34/D15). A probe that fails after
 * the wiring is in place leaves every event calling a guard that has just
 * demonstrated it does not answer: on Cursor that is failClosed, i.e. the whole
 * repository denied; on Codex a failed hook is NON-blocking, i.e. every write
 * unguarded. Smoking first makes the abort leave the three hosts untouched —
 * and the message has to say so, or the human cannot tell which it is.
 */
function smokeOrThrow(target: string): "pass" {
  const probe = spawnSync("node", [join(target, ENGINE_RELATIVE), "guard", "--platform=claude"], {
    input: JSON.stringify({
      hook_event_name: "PreToolUse", tool_name: "Write",
      tool_input: { file_path: join(target, "src", "__companion_smoke__.ts"), content: "x" },
      cwd: target,
    }),
    encoding: "utf8", timeout: 60_000,
  });
  if (probe.status === 2) return "pass";
  throw new Error(
    `安装中止：守卫冒烟没通过（退出码 ${probe.status}，期望 2）—— 引擎要么跑不起来，要么不拦，不能当装好了。\n`
    + `目标仓库现在是这样：\n`
    + `  已写入 —— ${ENGINE_RELATIVE}、${ENGINE_DIR}/FORMAT.md、.agents/skills/ 和 .claude/skills/ 下的技能；`
    + `ideas/ 下缺什么补什么（原有的图没被覆盖）。\n`
    + `  没动过 —— .claude/settings.json、.cursor/hooks.json、.codex/hooks.json 三家接线一个字节都没写，`
    + `所以没有任何 hook 指着这个答不出话的守卫，宿主配置还是安装之前的样子。\n`
    + `  没记进安装名单，--update 不会来刷新它。\n`
    + `修好之后重装一次就行；只想把写进去的文件撤掉：install.ts --uninstall ${target}（ideas/ 下的账本不碰）。\n`
    + `${probe.stdout ?? ""}${probe.stderr ?? ""}`);
}

export function install(targetDir: string, opts: InstallOptions = {}): InstallResult {
  const target = resolve(targetDir);
  const dryRun = opts.dryRun === true;
  const replaceLegacy = opts.replaceLegacy === true;
  if (!existsSync(target)) throw new Error(`目标不存在：${target}`);
  requireNodeOnPath();                                  // D34 — 前置先查，缺了就明确失败
  if (!existsSync(join(HERE, "dist", "companion.mjs"))) {
    throw new Error("先构建产物：node companion/build.mjs（安装的是单文件产物，不是源码指针）");
  }
  // The registry is a read-modify-write too (`remember` rewrites it at the very
  // end), so read it up front: an unreadable install list must stop us BEFORE
  // the target repository is touched, not after everything is already in place.
  const registryPath = opts.registryPath ?? DEFAULT_REGISTRY;
  readRegistry(registryPath);

  // Preflight (D34/D15). A dry run reports the finding instead of throwing:
  // refusing to even LOOK is how people end up running the destructive version
  // to find out what it would have done.
  const legacy = findLegacyWiring(target);
  if (legacy.length > 0 && !replaceLegacy && !dryRun) throw refuseLegacy(legacy);

  // H15/D10 — ask the engine about legacy graphs ALWAYS, not only when
  // ideas/graph.yaml is missing. Asking only when the seat is empty is exactly
  // the blind spot: the worst case is a legacy graph parked ON the canonical
  // name, and there the file DOES exist. Refuse before anything is written; a
  // dry run reports it in the plan instead, same as the wiring preflight above.
  const legacyGraphs = findLegacySources(target);
  const occupied = legacyGraphs.find((s) => s.instruction !== undefined);
  const canonicalLegacy = occupied === undefined ? undefined : canonicalGraphIsLegacy(occupied);
  if (occupied !== undefined && !dryRun) throw refuseCanonicalLegacy(occupied);

  const mode: MergeMode = { dryRun, replaceLegacy };
  const installed: string[] = [];

  for (const { src, rel } of ownedFiles()) {
    installed.push(rel);
    if (dryRun) continue;
    const dest = join(target, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }

  // Seed the ledger, never clobber it — and never seed over an un-migrated
  // legacy graph either (H13, see seedWouldLockOut). Ahead of the smoke,
  // because the guard the probe runs reads this graph.
  const graph = join(target, "ideas", "graph.yaml");
  // Only the empty-seat case is a SEED decision — when the canonical name is
  // occupied the preflight above has already spoken, so do not say it twice.
  const waiting = existsSync(graph) ? [] : legacyGraphs;
  const seedSkipped = waiting.length === 0 ? undefined : seedWouldLockOut(waiting);
  if (!existsSync(graph) && seedSkipped === undefined) {
    installed.push("ideas/graph.yaml");
    if (!dryRun) {
      mkdirSync(dirname(graph), { recursive: true });
      writeFileSync(graph, GRAPH_SEED.replace("PROJECT_NAME", target.split(/[\\/]/).pop() ?? "project"));
    }
  }
  if (repairIdeasIgnore(target, dryRun)) installed.push("ideas/.gitignore");

  // Prove the guard answers BEFORE handing the three hosts a hook that calls it
  // (D34/D15) — see smokeOrThrow. A dry run installed nothing, so there is
  // nothing to smoke.
  const smoke = dryRun ? "skipped" as const : smokeOrThrow(target);

  const plans = [
    mergeClaudeSettings(target, mode),
    mergeJsonHooks(join(target, ".cursor", "hooks.json"), cursorHooks(), mode),
    mergeJsonHooks(join(target, ".codex", "hooks.json"), codexHooks(), mode),
  ];
  const hooksAdded = plans.flatMap((p) => p.added);
  const hooksRemoved = plans.flatMap((p) => p.removed);
  installed.push(".claude/settings.json", ".cursor/hooks.json", ".codex/hooks.json");

  if (!dryRun) remember(target, registryPath);
  return { target, installed, smoke, hooksAdded, hooksRemoved, legacy, seedSkipped, canonicalLegacy };
}

interface MergeMode { dryRun: boolean; replaceLegacy: boolean }
interface HookPlan { added: string[]; removed: string[] }

/**
 * The one merge rule, shared by all three hosts: drop the entries that are
 * OURS, drop the previous generation's when the human asked for that, keep
 * every foreign entry exactly where it was, then append today's wiring.
 */
function applyHooks(
  file: string, hooks: Record<string, unknown[]>,
  manifest: Record<string, unknown[]>, mode: MergeMode,
): HookPlan {
  const plan: HookPlan = { added: [], removed: [] };
  // Legacy entries come out of EVERY event in the file, not just the events we
  // wire: one left on an event we do not touch is still a second engine running
  // on that event (D15).
  if (mode.replaceLegacy) {
    for (const [event, entries] of Object.entries(hooks)) {
      if (!Array.isArray(entries)) continue;
      const kept: unknown[] = [];
      for (const entry of entries) {
        const what = legacyMatch(entry);
        if (what === undefined) kept.push(entry);
        else plan.removed.push(`${file}  ${event}  ${describeEntry(entry)}   ←  ${what}`);
      }
      if (kept.length === 0 && !(event in manifest)) delete hooks[event];
      else hooks[event] = kept;
    }
  }
  for (const [event, groups] of Object.entries(manifest)) {
    const existing = (hooks[event] ?? []) as unknown[];
    // Strip our own previous entries first, so a re-install replaces instead
    // of accumulating — and leaves every foreign entry exactly where it was.
    // Matched on the engine's FILE NAME, not on today's path: an install that
    // relocated the engine must still recognise the wiring it wrote at the old
    // location, or the target keeps a second entry pointing at a file that is
    // gone — which on Cursor is failClosed, i.e. the whole repository denied.
    const foreign = existing.filter((g) => !JSON.stringify(g).includes(ENGINE_MARKER));
    hooks[event] = [...foreign, ...groups];
    for (const group of groups) plan.added.push(`${file}  ${event}  ${describeEntry(group)}`);
  }
  return plan;
}

/** Merge our hook groups into .claude/settings.json without touching anyone else's. */
function mergeClaudeSettings(target: string, mode: MergeMode): HookPlan {
  const file = join(target, ".claude", "settings.json");
  const settings = (readJsonBeforeOverwrite(file, "object") ?? {}) as { hooks?: Record<string, unknown[]> };
  settings.hooks ??= {};
  const plan = applyHooks(file, settings.hooks, claudeHooks(), mode);
  if (!mode.dryRun) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
  }
  return plan;
}

/** Same merge discipline for the Cursor/Codex hooks.json shapes. */
function mergeJsonHooks(
  file: string, manifest: { version?: number; hooks: Record<string, unknown[]> }, mode: MergeMode,
): HookPlan {
  const current = (readJsonBeforeOverwrite(file, "object") ?? {}) as { version?: number; hooks?: Record<string, unknown[]> };
  if (manifest.version !== undefined) current.version ??= manifest.version;
  current.hooks ??= {};
  const plan = applyHooks(file, current.hooks, manifest.hooks, mode);
  if (!mode.dryRun) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(current, null, 2) + "\n");
  }
  return plan;
}

export interface UninstallResult { target: string; removed: string[]; hooksRemoved: string[] }

/**
 * The inverse of install: our hook entries out of the three host configs, the
 * files this installer wholly owns off disk, the target out of the registry —
 * and nothing else. Not foreign hook entries, not the human's permissions list,
 * and above all not `ideas/graph.yaml`: the ledger is seeded once and written by
 * a human ever after, so deleting it is data loss, not clean-up.
 */
export function uninstall(
  targetDir: string, opts: { registryPath?: string; dryRun?: boolean } = {},
): UninstallResult {
  const target = resolve(targetDir);
  const dryRun = opts.dryRun === true;
  const hooksRemoved: string[] = [];

  for (const file of hostConfigs(target)) {
    const current = readJsonBeforeOverwrite(file, "object") as
      { version?: number; hooks?: Record<string, unknown[]> } | undefined;
    if (current === undefined) continue;
    const hooks = current.hooks;
    if (hooks !== undefined && hooks !== null && typeof hooks === "object") {
      for (const [event, entries] of Object.entries(hooks)) {
        if (!Array.isArray(entries)) continue;
        const kept = entries.filter((e) => !JSON.stringify(e).includes(ENGINE_MARKER));
        for (const entry of entries) {
          if (!kept.includes(entry)) hooksRemoved.push(`${file}  ${event}  ${describeEntry(entry)}`);
        }
        if (kept.length === 0) delete hooks[event];
        else hooks[event] = kept;
      }
    }
    if (dryRun) continue;
    // A config left holding nothing but an empty hook map is one we created —
    // leaving that behind is not a clean inverse. Anything else the human put in
    // the file (permissions, foreign hooks, unknown keys) keeps the file alive.
    const onlyOurs = Object.keys(current).every((k) => k === "hooks" || k === "version")
      && Object.keys(hooks ?? {}).length === 0;
    if (onlyOurs) rmSync(file, { force: true });
    else writeFileSync(file, JSON.stringify(current, null, 2) + "\n");
  }

  const removed: string[] = [];
  for (const { rel } of ownedFiles()) {
    if (!existsSync(join(target, rel))) continue;
    removed.push(rel);
    if (!dryRun) rmSync(join(target, rel), { force: true });
  }
  if (!dryRun) {
    pruneEmptyDirs(target, removed);
    forget(target, opts.registryPath ?? DEFAULT_REGISTRY);
  }
  return { target, removed, hooksRemoved };
}

/** Directories that existed only to hold the files just deleted. */
function pruneEmptyDirs(target: string, removedRels: string[]): void {
  const dirs = new Set<string>();
  for (const rel of removedRels) {
    let dir = dirname(join(target, rel));
    while (dir.length > target.length && dir.startsWith(target)) { dirs.add(dir); dir = dirname(dir); }
  }
  // Deepest first, and "is it empty" is not a question we ask: a directory that
  // still holds someone else's file simply refuses to be removed.
  for (const dir of [...dirs].sort((a, b) => b.length - a.length)) {
    try { rmdirSync(dir); } catch { /* not empty — someone else lives here */ }
  }
}

// ─── registry, status, update ───────────────────────────────────────────────

/** Same read-modify-write hazard: `remember` writes this list back whole. */
function readRegistry(registryPath: string): string[] {
  return (readJsonBeforeOverwrite(registryPath, "array") ?? []) as string[];
}

function remember(target: string, registryPath: string): void {
  const entries = new Set(readRegistry(registryPath));
  entries.add(target.replaceAll("\\", "/"));
  mkdirSync(dirname(registryPath), { recursive: true });
  writeFileSync(registryPath, JSON.stringify([...entries].sort(), null, 2) + "\n");
}

/** Drop an uninstalled target, so `--update` stops refreshing files that are gone. */
function forget(target: string, registryPath: string): void {
  if (!existsSync(registryPath)) return;
  const entries = readRegistry(registryPath).filter((e) => e !== target.replaceAll("\\", "/"));
  writeFileSync(registryPath, JSON.stringify(entries.sort(), null, 2) + "\n");
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

/**
 * D34 — 更新前先把产物重打出来，打不了就明确失败，不静默降级。
 * Copying without building is copying YESTERDAY: the bundle is generated, and
 * `--update` used to hand every installed repository whatever build.mjs last
 * happened to leave on disk — an engine fix shipped only if a human remembered
 * to run the build script by hand, and nothing said otherwise (H14). A build we
 * cannot run must stop the update before one byte is copied, because the
 * failure mode of carrying on is the silent one: six repositories still running
 * the old guard, and a command line that says 已是最新.
 */
function rebuildBundle(): void {
  const built = spawnSync("node", [join(HERE, "build.mjs")], { encoding: "utf8", timeout: 300_000 });
  if (built.error === undefined && built.status === 0) return;
  throw new Error(
    `更新中止：重打单文件产物失败（node companion/build.mjs 退出码 ${built.status}）。\n`
    + `不重打就只是把上一次的旧产物再抄一遍：装过的仓库全都还在跑旧引擎，命令行还会说"已是最新"。\n`
    + `多半是依赖没装 —— 产物是用 esbuild 打的，先在本仓库跑 npm install，再重来。\n`
    + `已安装的仓库一个字节都没动。\n`
    + `${built.stdout ?? ""}${built.stderr ?? ""}`);
}

export function updateAll(registryPath: string): { target: string; refreshed: string[]; hooksAdded: string[] }[] {
  rebuildBundle();                                     // D34 — 抄之前先重打，打不了就停在这里
  const out: { target: string; refreshed: string[]; hooksAdded: string[] }[] = [];
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
    // The wirings are MERGED into the three host configs, never copied there, so
    // no byte comparison can ever report them stale — statusOf does not even
    // look at them. That made a manifest change (a new event, a corrected
    // command string) something `--update` structurally could not deliver: it
    // reached a repository only on a full re-install nobody knew to run (H14).
    // Same merge rule as install: our own entries replaced, foreign entries
    // untouched, and the previous generation's left alone — pulling those needs
    // the human's explicit --replace-legacy (D15), which is an install decision,
    // not something a maintenance sweep gets to make on its own.
    const mode: MergeMode = { dryRun: false, replaceLegacy: false };
    const plans = [
      mergeClaudeSettings(target, mode),
      mergeJsonHooks(join(target, ".cursor", "hooks.json"), cursorHooks(), mode),
      mergeJsonHooks(join(target, ".codex", "hooks.json"), codexHooks(), mode),
    ];
    out.push({ target, refreshed, hooksAdded: plans.flatMap((p) => p.added) });
  }
  return out;
}

// ─── cli ────────────────────────────────────────────────────────────────────

/** Flags whose next argument is their value, not a positional. */
const VALUE_FLAGS = new Set(["--registry"]);

/**
 * The command line, read in ONE pass: a value-taking flag consumes its own
 * value and nothing else; everything that is not a flag is a positional.
 * Deciding it in two steps — find --registry, then drop the argument at that
 * index plus one — drops argv[0] whenever the flag is absent, because indexOf
 * answers -1 and -1 + 1 is index 0, the target repository. That killed the
 * documented primary form `install.ts <目标仓库>`: it always printed usage,
 * while every command line carrying an explicit --registry kept working.
 * A value-taking flag with nothing after it is a missing prerequisite, so it
 * fails loudly rather than silently falling back to the default (D34).
 */
function parseCommandLine(args: string[]): {
  flags: Set<string>; values: Map<string, string>; positional: string[];
} {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) { positional.push(arg); continue; }
    flags.add(arg);
    if (!VALUE_FLAGS.has(arg)) continue;
    const value = args[i + 1];
    if (value === undefined) throw new Error(`${arg} 后面要跟一个路径，现在什么都没有。`);
    values.set(arg, value);
    i += 1;                       // that argument belongs to this flag, nobody else
  }
  return { flags, values, positional };
}

if (process.argv[1]?.endsWith("install.ts")) {
  try {
    const { flags, values, positional } = parseCommandLine(process.argv.slice(2));
    const registryPath = values.get("--registry") ?? DEFAULT_REGISTRY;
    const dryRun = flags.has("--dry-run");
    const replaceLegacy = flags.has("--replace-legacy");
    const preview = dryRun ? "[--dry-run 预演，一个字节都没写] " : "";
    if (flags.has("--status")) {
      for (const target of readRegistry(registryPath)) {
        if (!existsSync(target)) { console.log(`${target}  (目录不存在，跳过)`); continue; }
        const stale = statusOf(target).filter((f) => f.state !== "current");
        console.log(stale.length === 0 ? `${target}  全部最新`
          : `${target}\n${stale.map((f) => `  ${f.state}  ${f.rel}`).join("\n")}`);
      }
    } else if (flags.has("--update")) {
      const updated = updateAll(registryPath);
      console.log(`单文件产物已重打（node companion/build.mjs）。`);
      for (const { target, refreshed, hooksAdded } of updated) {
        console.log(`${target}  刷新 ${refreshed.length} 个文件，重新合并 ${hooksAdded.length} 条接线`);
      }
    } else if (flags.has("--uninstall") && positional[0]) {
      const result = uninstall(positional[0], { registryPath, dryRun });
      console.log(`${preview}从 ${result.target} 卸载：`);
      for (const rel of result.removed) console.log(`  删文件  ${rel}`);
      for (const line of result.hooksRemoved) console.log(`  删接线  ${line}`);
      console.log(`账本没动：ideas/graph.yaml 和它的日志是人写的东西，卸载不碰。`);
    } else if (positional[0]) {
      const result = install(positional[0], { registryPath, dryRun, replaceLegacy });
      if (dryRun) {
        console.log(`${preview}装进 ${result.target} 会做这些事：`);
        for (const rel of result.installed) console.log(`  写文件  ${rel}`);
        for (const line of result.hooksRemoved) console.log(`  删接线  ${line}`);
        for (const line of result.hooksAdded) console.log(`  加接线  ${line}`);
        if (result.seedSkipped !== undefined) console.log(`\n${result.seedSkipped}`);
        // H15 — 预演见到规范名字被旧图占着，必须当场说；不然打出来的是一份看着一切
        // 正常的计划，而真装那一步会被拒。
        if (result.canonicalLegacy !== undefined) {
          console.log(`\n但现在这样装会被拒绝 —— ${result.canonicalLegacy}`);
        }
        if (result.legacy.length > 0 && !replaceLegacy) {
          console.log(`\n但现在这样装会被拒绝 —— 目标里还留着上一代的接线：`);
          for (const hit of result.legacy) console.log(showHit(hit));
          console.log(`要连它们一起换掉，加 --replace-legacy。`);
        }
      } else {
        console.log(`装进 ${result.target}：${result.installed.length} 处，守卫冒烟 ${result.smoke}`);
        for (const line of result.hooksRemoved) console.log(`  删掉上一代接线  ${line}`);
        console.log(`三家接线就位（.claude/settings.json、.cursor/hooks.json、.codex/hooks.json）。`);
        console.log(`Codex 一次性步骤：在 Codex 里跑 /hooks 审阅并信任这几条 hook。`);
        // H13 — 旧图还在时下一步只有一个，别让人在 /ccscan 和 migrate 之间挑错。
        if (result.seedSkipped !== undefined) console.log(`\n${result.seedSkipped}`);
        else console.log(`下一步：在目标仓库里用 /ccscan 建图，或 migrate 迁旧图。`);
      }
    } else {
      console.error("usage: install.ts <目标仓库> [--replace-legacy] [--dry-run]"
        + " | --uninstall <目标仓库> [--dry-run] | --status | --update   [--registry <path>]");
      process.exit(2);
    }
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(1);
  }
}
