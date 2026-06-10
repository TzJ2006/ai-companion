# AGENTS.md

This file provides guidance to Codex (codex.ai/code) when working with code in this repository.

## Project Overview

AI Dev Companion — a TypeScript monorepo that tracks code changes at function-level granularity for Python and TypeScript projects. It parses git diffs, identifies which functions were modified, records reasons, generates test skeletons, and renders annotated HTML reports.

On top of that tracking core, the repo carries a **custom planning/execution workflow** (a set of Claude Code skills) that this project is developed *with*. Understanding that workflow (below) is usually more important than the tracking core, because most changes here flow through it.

## Commands

```bash
npm install
npm run build          # tsc --build (project references)
npm run clean          # tsc --build --clean
npm run test           # vitest (sequential, no parallelism)
npm run lint           # eslint packages/*/src/**/*.ts

# Single test (path-based — tests live in .devcompanion/tests/, not colocated)
npx vitest run .devcompanion/tests/test_ast_parseFile.test.ts

# Report generation
npx tsx scripts/collect-report-data.ts
npx tsx scripts/generate-report.ts
npx tsx scripts/generate-overview.ts --target <project-path>

# Onboarding pipeline (LLM analysis → ECL → tests → overview)
npx tsx scripts/run-onboarding.ts <project-path>

# Dashboard (Fastify web UI for scanned projects)
npm run dashboard:start | dashboard:stop | dashboard:restart | dashboard:status
```

## Skills Pipeline (how work happens in this repo)

This repo is developed through a chain of Claude Code **slash commands**. Each is registered by a file in `.claude/commands/<name>.md` (frontmatter `description` + body) that points to the full spec in `skills/<name>/SKILL.md`. Adding/wiring a skill = create both files; a skill that has a `SKILL.md` but no `.claude/commands/` entry is **not invocable**.

```
/idea  ──▶  /ccdiscuss  ──▶  /ccplan  ──▶  /ccedit  ──▶  /ccdebug
 backlog     alignment       planning      execution     debug-on-fail
                                  ▲
                            /cconboard (onboard an existing codebase)
```

- **/ccdiscuss** — best-effort conversational alignment BEFORE planning. Human writes the expected result FIRST, then the AI emits its "5 questions" (是什么 / 为什么做 / 如何做 / 为什么这样做 / 期望结果) and flags divergence; output is an aligned ECL. NOT a gate — `/ccplan` reads it *if present*. Read-only (only writes `docs/ecl/*.yaml`).
- **/ccplan** — diverge-then-converge requirement engineering (12-phase spiral: calibrate → hypothesize → challenge → diverge → converge → probe → confront → **review-gate (Phase 9, STOP for approval)** → implement → loop). Output is an ECL document. Read-only until approved.
- **/ccedit** — DAG-driven executor for an *approved* ECL. Topologically sorts the FN-layer graph, fans out one subagent per independent node (parallel), runs each node's `verify`, and writes `status` back. Routes failures to `/ccdebug`. See `@aidev/exec` below.
- **/ccdebug** — failure → source function → change history → root cause → fix. Enforces fix-code-not-tests, max 3 retries, full regression.
- **/cconboard** — scan/analyze/modularize/test/document an existing codebase; archives originals into `archive/`.
- **/idea** — idea backlog + research (`/idea add|list|research|show`).

When asked to plan, design, or implement a non-trivial change, prefer invoking the relevant skill over ad-hoc edits.

## ECL — Evolving Constraint Language (`docs/ecl/*.yaml`)

ECL YAML files are the persistent artifact threaded through the whole pipeline. A single file can play three roles:

1. **Planning document** — `/ccplan` output: requirements (REQ), features (FEAT), modules (MOD), functions (FN), decisions (DEC), adversarial findings, phase status. Schema in `skills/ccplan/ecl-schema.md`.
2. **Execution DAG** — `/ccedit` input: the `functions:` list, where each FN node has the *executable* schema `{ id, name, depends_on[], output{file,symbol}, verify{command,pass_condition}, status }`. `status` ∈ `pending|in-progress|done|blocked`. Only the `/ccedit` orchestrator writes `status` (atomic temp-file + rename); subagents never do.
3. **Feature guard** — a `feature_guard` section lists `key_files`, `invariants`, and a `verification` command. When present, the guard activates on any edit to a key file; run the verification after touching guarded files. Consumed by `/ccplan --guard [--verify]`.

`verify.command` is split on whitespace and spawned as a single argv (no pipes/`&&`/redirection) — use `npx vitest run <path>`, not shell one-liners.

## Architecture

```
packages/
├── types      @aidev/types     — Shared interfaces (analysis, modularity, history)
├── ast        @aidev/ast       — Tree-sitter WASM parsers (Python + TS), function extraction, identity hashing
├── core        @aidev/core     — Diff parsing, change annotation, test generation, analysis, modularity
├── history     @aidev/history  — JSON file store (reviews/, history/, index.json)
├── render       @aidev/render  — HTML report rendering (session view + onboard view)
├── cli          @aidev/cli     — Commander CLI `aidev` (review, render, history, init, onboard, analyze, idea)
├── hook         @aidev/hook    — Claude Code PostToolUse hook handler (<100ms)
├── daemon       @aidev/daemon  — Background queue processor for async diff + storage
├── exec         @aidev/exec    — ECL FN-DAG executor (the engine behind /ccedit)
├── llm          @aidev/llm     — Thin wrapper around the Claude CLI (callClaude, preflight)
├── idea         @aidev/idea    — Idea backlog store + research runner (behind /idea)
└── dashboard    @aidev/dashboard — Fastify web UI that scans projects and serves reports
```

**Dependency flow**: `types` ← `ast` ← `core` ← `history` ← `render` ← `cli`; `hook` uses core + history; `daemon` wraps hook. `llm` is standalone; `idea` uses `llm`; `exec` depends only on `yaml`; `dashboard` is standalone (fastify). `scripts/lib/*` uses `ast` + `types` + `llm`.

### Core subsystems (`packages/core/`)

- `diff/` — unified diff parsing, change annotation, git integration
- `analysis/` — function-level analysis (heuristic + LLM), batch processing
- `modularity/` — cohesion/coupling metrics, contract generation, refactor recommendations
- `test-gen/` — test skeleton generation for Python and TypeScript

### AST internals (`packages/ast/`)

- `wasm-resolver.ts` — single source for tree-sitter WASM path resolution (searches up node_modules)
- `parser-factory.ts` — parser instantiation
- `parser.ts` / `ts-parser.ts` — language-specific extraction (Python / TypeScript)
- `multi-lang.ts` — extension-based dispatch via `parseFileAuto`

### Exec engine (`packages/exec/`) — the `/ccedit` runtime

Exports (`index.ts`): `parseEclDag`, `validateFnFields`, `topologicalSort` (Kahn → `ExecutionLayer[]`), `getExecutionState`/`getReadyNodes`, `buildSubagentContext`/`formatSubagentPrompt`, `updateFnStatus`, `runVerification`, `loadExecConfig`. Driven via `packages/exec/src/cli.ts` subcommands: `parse | state | set-status <id> <status> | verify <id>`.

- **Windows spawn gotcha** (`runVerification`): `execFile(shell:false)` cannot resolve `.cmd` shims (e.g. `npx`→`npx.cmd`) → spawn `ENOENT`; but `shell:true` lets cmd.exe mangle metacharacters (the `>` inside `=>`). The fix tries `shell:false` first and falls back to `shell:true` **only** on a win32 `ENOENT`. Locked by `.devcompanion/tests/test_exec_runVerification.test.ts` — don't revert it to a single shell mode.

### Onboarding pipeline (`scripts/lib/`)

`run-onboarding.ts` → `onboarding-pipeline.ts` orchestrates: project detection → AST scan → LLM function analysis (`enhanced-analyzer.ts`, `opus-ecl-generator.ts` via `@aidev/llm`) → semantic ECL inference → test skeleton generation → overview HTML. This is the engine behind `/cconboard` and `/ccplan` Phase 10.

## Key Concepts

- **Function Identity**: `sha256(file_path + class_name + function_name + param_types)[0:16]` — stable across line-number drift.
- **Two trigger modes**: hook (auto, captures reason from AI context) + CLI (manual, user-provided reason). The hook records `.py`/`.ts` at function level and degrades **unsupported extensions to file-level** events (e.g. `.yaml`/`.md`) rather than dropping them; events queue at `<projectRoot>/.devcompanion/queue/events.jsonl`.
- **Storage**: plain JSON in `.devcompanion/` — no database.
- **Config registry**: `devcompanion.config.ts` declares all modules, exports, dependencies, and paths. Update this file when adding a package or changing public exports.

## Workspace Structure

- npm workspaces with `packages/*`; TypeScript project references (root `tsconfig.json` references each package).
- ESM throughout (`"type": "module"`, `NodeNext` module resolution).
- `archive/` holds timestamped snapshots of previous package states (created by `/cconboard`).
- This repo runs on **Windows / bash**: use Unix paths (`/dev/null`, forward slashes); watch the `.cmd`-shim gotcha above when spawning tools.

## Testing

- Vitest with `fileParallelism: false` (sequential).
- Tests live in `.devcompanion/tests/` (NOT colocated). Convention: `test_<module>_<functionName>.test.ts` (some older tests use shorter names).
- Path aliases in `vitest.config.ts` (`@aidev/ast`, `@aidev/core`, `@aidev/history`, `@aidev/render`) resolve to **source**, not dist.
- WASM tests need the tree-sitter `.wasm` files in `node_modules/` — run `npm install` first.

## CLI Usage

```bash
node packages/cli/dist/main.js <command> -p <target-project-path>
```
Commands: `init`, `review`, `render`, `history`, `onboard`, `analyze`, `idea`.
