# AGENTS.md

AI Dev Companion — a TypeScript monorepo (npm workspaces, `packages/*`, ESM, TypeScript project
references) that tracks code changes at function-level granularity for Python and TypeScript
projects: it parses git diffs, attributes hunks to functions via tree-sitter, records reasons, and
renders annotated HTML reports. On top of the tracking core sits a skill pipeline
(`/idea → /ccdiscuss → /ccplan → /ccedit → /ccdebug`, plus `/cconboard`, `/ccoverview`, `/ccaudit`)
that `scripts/install.ts` installs into other repos. This repo dogfoods its own tracker: the hooks
in `.claude/settings.json` run `packages/hook/dist`. Main entry points: `packages/cli/dist/main.js`
(the `aidev` CLI) and `scripts/*.ts` (run with `npx tsx`).

## Commands

```bash
npm install            # also fetches the tree-sitter .wasm files tests need
npm run build          # tsc --build (project references) — outputs packages/*/dist
npm run clean          # tsc --build --clean
npx vitest run                                             # full test suite, one-shot
npx vitest run .devcompanion/tests/test_exec_parseEclDag.test.ts   # single test file

# aidev CLI (build first): init | review | render | history | onboard | analyze | idea | install
node packages/cli/dist/main.js <command> -p <target-project-path>

# Install/manage the companion in other repos (idempotent, registry-tracked)
npx tsx scripts/install.ts <target-path> [--enforce] [--no-commands] [--agent claude|codex|both] [--public|--private]
npx tsx scripts/update.ts | scripts/status.ts | scripts/uninstall.ts <target-path>

# Onboarding pipeline (LLM analysis → ECL → tests → overview HTML)
npx tsx scripts/run-onboarding.ts <project-path>
npx tsx scripts/generate-overview.ts --target <project-path>

# Dashboard (Fastify web UI over scanned projects)
npm run dashboard:start | dashboard:stop | dashboard:restart | dashboard:status

# ECL DAG executor CLI (the /ccedit engine)
npx tsx packages/exec/src/cli.ts parse|state|set-status|verify <ecl-path> [...]
```

## Architecture

```
packages/
├── types      @aidev/types     — shared interfaces
├── ast        @aidev/ast       — tree-sitter WASM parsers (Python + TS); wasm-resolver.ts is the
│                                  single source for .wasm path lookup; identity.ts hashes functions
├── core       @aidev/core      — diff/ (parse + annotate), analysis/, modularity/, test-gen/
├── history    @aidev/history   — JSON file store (.devcompanion/: reviews/, history/, index.json)
├── render     @aidev/render    — self-contained inline diff rendering + annotation panels → HTML reports
├── cli        @aidev/cli       — Commander CLI `aidev` (main.ts registers the 8 commands above)
├── hook       @aidev/hook      — Claude/Codex PostToolUse + PreToolUse hook handlers (<100ms)
├── daemon     @aidev/daemon    — background queue processor (async diff + storage)
├── exec       @aidev/exec      — ECL FN-DAG executor behind /ccedit (parse, toposort, verify)
├── llm        @aidev/llm       — thin Claude CLI wrapper
├── idea       @aidev/idea      — idea backlog + research runner
└── dashboard  @aidev/dashboard — Fastify web UI
```

- **Skills pipeline**: one agent-neutral spec per skill in `skills/<name>/SKILL.md`; Claude Code
  invokes via `.claude/commands/<name>.md`, Codex via `.agents/skills/<name>/SKILL.md`. A new skill
  needs all three pieces. Prefer invoking a skill over ad-hoc edits for non-trivial changes.
- **ECL** (`docs/ecl/*.yaml`, schema in `skills/ccplan/ecl-schema.md`) is the artifact threading the
  pipeline: /ccplan planning doc → /ccedit execution DAG (`functions:` nodes with
  `{id, depends_on, output, verify, status}`) → optional `feature_guard` section. Only the /ccedit
  orchestrator writes `status` (atomic temp-file + rename in `packages/exec/src/status-manager.ts`);
  subagents never do.
- **Hook data flow**: Edit/Write → hook appends to `<projectRoot>/.devcompanion/queue/events.jsonl`;
  every non-AST extension degrades to a file-level event (`file_level: true`) instead of being
  dropped — only a small binary blacklist (images, archives, executables, ...) is skipped; the hook
  then spawns a short-lived queue worker (`packages/daemon/src/worker.ts`, launch-gated) that does
  the AST diffing + storage asynchronously.
- **Function identity** = `sha256(file_path + class_name + function_name + param name:type pairs)[0:16]` —
  stable across line-number drift.
- `devcompanion.config.ts` is the module registry (paths, exports, dependencies). Update it when
  adding a package or changing public exports.

## Conventions

- 2-space indentation; kebab-case source filenames (`status-manager.ts`, `wasm-resolver.ts`).
- ESM everywhere (`"type": "module"`, `NodeNext`); relative imports use explicit `.js` extensions.
- Tests are NOT colocated: they live in `.devcompanion/tests/` (kept tracked via `.gitignore`
  exception), named `test_<module>_<functionName>.test.ts` (older ones vary). Vitest only picks up
  `.devcompanion/tests/**/*.test.ts`.
- `vitest.config.ts` aliases `@aidev/*` to package **source** (`src/index.ts`), not dist, and sets
  `fileParallelism: false` (sequential files).

## Gotchas

- `npm run test` starts vitest in **watch mode and never exits**. Always use `npx vitest run [path]`.
- `npm run lint` is a dead script: eslint is not installed anywhere in the workspace (zero hits in
  `package-lock.json`). Don't rely on it; don't "fix" it by adding eslint without being asked.
- **Windows spawn gotcha** (`runVerification` in `packages/exec/src/status-manager.ts`):
  `execFile(shell:false)` can't resolve `.cmd` shims (`npx` → `npx.cmd`) → spawn `ENOENT`, but
  `shell:true` lets cmd.exe mangle metacharacters. The code tries `shell:false` first and falls back
  to `shell:true` only on win32 `ENOENT`. Locked by
  `.devcompanion/tests/test_exec_runVerification.test.ts` — don't collapse it to a single mode.
- ECL `verify.command` is split on whitespace and spawned as one argv — no pipes, `&&`, or
  redirection. Use `npx vitest run <path>`, not shell one-liners.
- The Claude hooks run `packages/hook/dist/*.js` — rebuild (`npm run build`) after editing
  `packages/hook/src` or the live hooks keep executing stale code. Same for the CLI: `aidev` runs
  from `packages/cli/dist`.
- Install-registry paths are normalized with filesystem casing (`realpathSync.native`) so
  `GitHub` vs `Github` matches on Windows.
- WASM-dependent tests need the tree-sitter `.wasm` files under `node_modules/` — `npm install` first.
