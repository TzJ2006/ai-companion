# AI Dev Companion

A structured code change tracking tool for Python and TypeScript projects. Records every modification at function-level granularity with reasons, generates tests, and renders annotated HTML reports.

## What It Does

1. **Tracks changes** — Parses git diffs, identifies which functions were modified, and records line-level changes with reasons
2. **Generates HTML reports** — reason-grouped collapsible diff visualization with per-function annotations
3. **Maintains history** — JSON-based per-file history indexed by function signature hash, queryable by file/function/time
4. **Integrates with Claude Code and Codex** — Auto-captures Claude Edit/Write and Codex apply_patch changes via PostToolUse hooks; reasons come directly from AI context

## Architecture

```
packages/
├── types/     — Shared interfaces
├── ast/       — Python/TS parsers (web-tree-sitter): function signatures, identity
├── core/      — Diff parser + change annotator + test prompt generator
├── history/   — JSON file store: reviews/, history/, index.json
├── render/    — self-contained inline diff rendering + annotation panels → HTML
├── cli/       — Commands: init, review, render, history, install, …
├── hook/      — Claude Code and Codex PostToolUse hook adapter (lightweight, <100ms)
├── daemon/    — Background queue processor (async diff + storage)
├── exec/      — ECL FN-DAG executor (/ccedit)
├── llm/       — Claude CLI wrapper
├── idea/      — Idea backlog + research
└── dashboard/ — Fastify web UI for scanned projects
```

**Install into other repos:** `npx tsx scripts/install.ts <target> [--enforce]` (registry-tracked). `aidev install` **delegates** to that script (same registry + hooks). Rebuild the CLI (`npm run build`) after pulling so `packages/cli/dist` picks up the wrapper. Registry paths are normalized with filesystem casing (`realpathSync.native`) so `GitHub` vs `Github` matches on Windows.

## Quick Start

```bash
cd ai-dev-companion
npm install
npm run build

# Initialize in your Python or TypeScript project
node packages/cli/dist/main.js init -p /path/to/your/project

# After making changes, record them
node packages/cli/dist/main.js review -p /path/to/your/project --reason "Added auth module"

# Generate HTML report
node packages/cli/dist/main.js render -p /path/to/your/project --latest

# View change history
node packages/cli/dist/main.js history -p /path/to/your/project src/utils.py
```

## Key Design Decisions

- **Function identity** = `sha256(file_path + class_name + function_name + param_types)` — survives line-number drift
- **Two trigger modes**: hook (auto, captures reason from AI context) + CLI (manual, user-provided or LLM-inferred reason)
- **Storage**: plain JSON files organized by source file path — human/AI readable, no database dependency
- **v1 scope**: Python and TypeScript projects; language adapter interface designed for future extension
- **Security**: `.devcompanion/` auto-added to `.gitignore`; sensitive files excluded from recording

## Requirements

- Node.js 18+
- Git (project must be a git repository)
- Python or TypeScript source files to analyze

## Output Format

Each review session produces a JSON file:

```json
{
  "id": "uuid",
  "timestamp": "2026-05-15T14:57:20.874Z",
  "trigger": "cli",
  "summary": "3 function-level changes across 1 files",
  "changes": [
    {
      "function_name": "power",
      "function_hash": "c86c20450ea449a5",
      "change_type": "add",
      "reason": "Added power utility function",
      "start_line": 33,
      "end_line": 38,
      "test_status": "pending"
    }
  ]
}
```

## Project Status

Core functionality implemented and verified:
- [x] Python and TypeScript AST parsing (functions, classes, methods, decorators, type annotations)
- [x] Git diff parsing and function-level change attribution
- [x] JSON history storage with index
- [x] HTML report rendering (self-contained inline diffs + annotation panels)
- [x] CLI commands (init, review, render, history, onboard, analyze, idea, install)
- [x] Claude Code + Codex hook integration end-to-end (PostToolUse capture, PreToolUse guard)
- [x] Queue processing via hook-spawned short-lived worker
- [x] LLM-powered test generation (onboarding pipeline)
