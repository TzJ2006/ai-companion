# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Dev Companion — a TypeScript monorepo that tracks code changes at function-level granularity for Python and TypeScript projects. It parses git diffs, identifies which functions were modified, records reasons, generates test skeletons, and renders annotated HTML reports.

## Commands

```bash
npm install
npm run build          # tsc --build (project references)
npm run clean          # tsc --build --clean
npm run test           # vitest (sequential, no parallelism)
npm run lint           # eslint packages/*/src/**/*.ts

# Single test
npx vitest run .devcompanion/tests/test_ast_parseFile.test.ts

# Report generation
npx tsx scripts/collect-report-data.ts
npx tsx scripts/generate-report.ts

# Demo reports (ECL-annotated, test-design)
npx tsx scripts/demo-ecl-report.ts
npx tsx scripts/demo-test-design-report.ts
```

## Architecture

```
packages/
├── types     @aidev/types    — Shared interfaces (analysis, modularity, history)
├── ast       @aidev/ast      — Tree-sitter WASM parsers (Python + TS), function extraction, identity hashing
├── core      @aidev/core     — Diff parsing, change annotation, test generation, analysis, modularity
├── history   @aidev/history  — JSON file store (reviews/, history/, index.json)
├── render    @aidev/render   — HTML report rendering (session view + onboard view)
├── cli       @aidev/cli      — Commander-based CLI (init, review, render, history, onboard)
├── hook      @aidev/hook     — Claude Code PostToolUse hook handler (<100ms)
└── daemon    @aidev/daemon   — Background queue processor for async diff + storage
```

**Dependency flow**: `types` ← `ast` ← `core` ← `history` ← `render` ← `cli`; `hook` uses core + history; `daemon` wraps hook.

### Core subsystems

- `core/diff/` — unified diff parsing, change annotation, git integration
- `core/analysis/` — function-level analysis (heuristic + LLM), batch processing
- `core/modularity/` — cohesion/coupling metrics, contract generation, refactor recommendations
- `core/test-gen/` — test skeleton generation for Python and TypeScript

### AST internals

- `wasm-resolver.ts` — single source for tree-sitter WASM path resolution (searches up node_modules)
- `parser-factory.ts` — parser instantiation
- `parser.ts` / `ts-parser.ts` — language-specific extraction (Python / TypeScript)
- `multi-lang.ts` — extension-based dispatch via `parseFileAuto`

## Key Concepts

- **Function Identity**: `sha256(file_path + class_name + function_name + param_types)[0:16]` — stable across line-number drift
- **Two trigger modes**: hook (auto, captures reason from AI context) + CLI (manual, user-provided reason)
- **Storage**: plain JSON in `.devcompanion/` — no database
- **Config registry**: `devcompanion.config.ts` declares all modules, exports, dependencies, and paths. Update this file when adding new packages or changing public exports.
- **ECL feature guards**: `docs/ecl/*.yaml` files define invariants and verification commands per feature area. Each guard lists `key_files`, `invariants` (rules that must hold), and a `verification` command. Run the verification command after touching guarded files. Consumed by the `/ccplan --guard` workflow.

## Workspace Structure

- npm workspaces with `packages/*`
- TypeScript project references (root `tsconfig.json` references each package)
- ESM throughout (`"type": "module"`, `NodeNext` module resolution)
- `archive/` holds timestamped snapshots of previous package states (created by `/cconboard`)

## Testing

- Framework: Vitest with `fileParallelism: false` (tests run sequentially)
- Location: `.devcompanion/tests/` (not colocated with source)
- Naming convention: `test_<module>_<functionName>.test.ts` (some older tests use shorter names like `parser.test.ts`)
- Path aliases in `vitest.config.ts`: `@aidev/ast`, `@aidev/core`, `@aidev/history`, `@aidev/render`
- Tests import from source (not dist) via these aliases
- WASM tests require the tree-sitter `.wasm` files present in `node_modules/` — run `npm install` first

## CLI Usage

```bash
node packages/cli/dist/main.js <command> -p <target-project-path>
```
Commands: `init`, `review`, `render`, `history`, `onboard`