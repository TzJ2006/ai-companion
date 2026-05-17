# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Dev Companion — a TypeScript monorepo that tracks code changes at function-level granularity for Python (and TypeScript) projects. It parses git diffs, identifies which functions were modified, records reasons, generates test skeletons, and renders annotated HTML reports.

## Commands

```bash
# Install
npm install

# Build (TypeScript project references)
npm run build          # or: tsc --build

# Clean build artifacts
npm run clean          # or: tsc --build --clean

# Run all tests
npm run test           # or: vitest

# Run a single test file
npx vitest run .devcompanion/tests/test_ast_parseFile.test.ts

# Lint
npm run lint

# Run report scripts
npx tsx scripts/collect-report-data.ts
npx tsx scripts/generate-report.ts
```

## Architecture

```
packages/
├── ast       @aidev/ast      — Tree-sitter parsers (Python + TS), function extraction, identity hashing
├── core      @aidev/core     — Diff parsing, change annotation, test skeleton generation
├── history   @aidev/history  — JSON file store (reviews/, history/, index.json)
├── render    @aidev/render   — HTML report rendering (session view + onboard view)
├── cli       @aidev/cli      — Commander-based CLI (init, review, render, history, onboard)
├── hook      @aidev/hook     — Claude Code PostToolUse hook handler (<100ms)
└── daemon    @aidev/daemon   — Background queue processor for async diff + storage
```

**Dependency flow**: `ast` ← `core` ← `history` ← `render` ← `cli`; `hook` uses core + history; `daemon` wraps hook.

## Key Concepts

- **Function Identity**: `sha256(file_path + class_name + function_name + param_types)[0:16]` — survives line-number drift, changes when contract changes
- **Two trigger modes**: hook (auto, captures reason from AI context) + CLI (manual, user-provided reason)
- **Storage**: plain JSON in `.devcompanion/` — no database
- **Config registry**: `devcompanion.config.ts` at root declares all modules, their exports, dependencies, and test/report paths

## Workspace Structure

- npm workspaces with `packages/*`
- TypeScript project references (root `tsconfig.json` references each package)
- Each package has its own `tsconfig.json` and `package.json`
- All packages use ESM (`"type": "module"`) with `NodeNext` module resolution

## Testing

- Framework: Vitest
- Test location: `.devcompanion/tests/` (not colocated with source)
- Naming convention: `test_<module>_<functionName>.test.ts`
- Path aliases in `vitest.config.ts`: `@aidev/ast`, `@aidev/core`, `@aidev/history`, `@aidev/render`
- Tests import from source (not dist) via these aliases

## CLI Usage

After build, the CLI is at `packages/cli/dist/main.js`:
```bash
node packages/cli/dist/main.js <command> -p <target-project-path>
```
Commands: `init`, `review`, `render`, `history`, `onboard`
