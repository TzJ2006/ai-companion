# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

A gated idea-graph development harness for AI coding agents. Core principle: every idea in a project is one node in a graph (`ideas/graph.yaml`); every prerequisite is one edge. Hooks enforce that product code cannot be edited unless a corresponding idea is approved by a human and marked `doing`. If it is not in the graph, it is not tracked.

Three sibling implementations live here, and they are being unified into one shared base:

- `companion/` — **the shared base** (spec + decision table now; engine, guard, and installer land there via ideas I-070–I-074). `companion/FORMAT.md` is the single authoritative spec for every agent; its 分歧裁决表 records how each divergence between the three implementations was adjudicated, and why.
- `claude-companion/` — the Claude Code version; still the authoritative engine until I-070 moves it into `companion/`.
- `codex-companion/`, `cursor-companion/` — versions for other agents. The old "never modify them" ban was lifted on 2026-08-29 when the human approved the shared-base plan (ideas I-069–I-075). The target is one shared engine, guard policy, graph, and set of Agent Skills; each product keeps only its native manifest and hook-event mapping. Do not delete the existing implementations until I-073/I-074 have passed their real-product manual checks, and do not modify either adapter before its idea is `doing`.
- The old ECL workflow (`/ccplan → /ccedit → /ccdebug`) is retired.

## The guard is active in this repository

`.claude/settings.json` wires `claude-companion/guard.ts` into PreToolUse, PostToolUse, Stop, and UserPromptSubmit. You will be blocked by your own rules while working here:

- Edits to product code are denied unless an idea is `doing` (with `how`, `expected`, `verify`, `code.file` filled, prerequisites done) and the edited file is in that idea's `code` or `verify.command`.
- Approval only comes from the human typing an entire message of exactly `批准` / `approve` / `同意` (UserPromptSubmit event — an agent cannot produce it). Approval binds to the graph's sha256; any graph change invalidates it.
- Test-first: implementation edits are blocked until the idea's test file exists and fails.
- Change statuses with `ideas.ts set`, never by hand-editing the yaml.
- Ledger files (`ideas/graph*.yaml`, `log*.md`, `graph*.html`) are always editable; `.approved*` and `.scan-todo*` are write-protected (Write would let the agent forge approvals).
- Escape hatch: `AIDEV_GUARD=off` disables all seven rules. The guard fails open — its own crashes never lock you out.

This checkout still runs the pre-unification Claude engine, so **until I-070/I-074 performs the explicit migration**, its live files remain `ideas/graph.claude.yaml`, `ideas/log.claude.md`, `ideas/.approved.claude`, and `ideas/.scan-todo.claude`. Do not hand-create `ideas/graph.yaml` or copy state between suffixes. The target defined by D10/D28 is one project-owned `ideas/graph.yaml` plus generated evidence shared by Claude, Cursor, and Codex; legacy suffix files become read-only migration inputs. The future `paths` command will print the canonical paths without an agent selector.

Note: `.claude/settings.json` also references `packages/hook/dist/*` from the retired ECL workflow; that directory no longer exists, so those hook invocations are harmless no-ops.

## Commands

```bash
npm test                                                      # all tests, one-shot (vitest run --dir .devcompanion/tests)
npx vitest run .devcompanion/tests/test_ideas_guard.test.ts   # one test file
```

Engine (usually invoked by the slash commands, but runnable directly; all subcommands accept `--file <graph>` and `--project <dir>`):

```bash
npx tsx claude-companion/ideas.ts check     # validate the graph, exit 1 on errors
npx tsx claude-companion/ideas.ts next      # ideas that can be started now (frontier)
npx tsx claude-companion/ideas.ts show I-014
npx tsx claude-companion/ideas.ts render    # regenerate the graph.html visualization
npx tsx claude-companion/ideas.ts set I-014 done --by me --note "reason"
npx tsx claude-companion/ideas.ts scan      # scan checklist progress: read N of M files
```

Installing into other repositories:

```bash
npx tsx claude-companion/install.ts <target-repo-path>
npx tsx claude-companion/install.ts --status   # compare installed copies against source, byte-for-byte
npx tsx claude-companion/install.ts --update   # refresh stale copies
```

Only the five command files are copied; the engine is shared — every installed repository runs this one copy, so engine edits take effect everywhere immediately. Installs are recorded in `claude-companion/.installs.json` (machine-local absolute paths, not committed). The comparison normalizes CRLF/LF first — on Windows, git checks out CRLF and installs write LF, and without normalization every install reports permanently stale.

## Architecture

- `claude-companion/ideas.ts` — the engine: yaml graph parsing, validation (`check`), topological frontier (`next`), HTML rendering, gated status transitions, file-name suffix resolution, scan checklist.
- `claude-companion/guard.ts` — single hook entry point; reads the hook event JSON from stdin, dispatches on event type, and enforces the seven rules (R1 auto-log every edit, R2 status transitions via `set` only, R3 test-first, R4 no edits on un-thought-through ideas, R5 graph must validate on Stop, R6 human approval, R7 scan checklist crossed off by real Read events only).
- `claude-companion/install.ts` — installer plus install registry (`--status` / `--update`).
- `claude-companion/commands/*.md` — source of truth for the five slash commands; `.claude/commands/*.md` at the repository root is this repository's installed copy of them.
- `claude-companion/FORMAT.md` — the node format: eight questions per idea (what, why, expected, how, why_this_way, code location, verify, future use), `needs` edges, append-only per-node log. Graph prose must be readable by someone who never opened the repository — no unexplained project jargon.
- `.devcompanion/tests/` — vitest suites covering the engine and the guard.

## Workflow (the five slash commands)

| Command | Purpose |
|---|---|
| `/ccscan` | Read the whole project (hook-tracked checklist, not self-reported), build the idea graph, render it, stop for human review |
| `/ccthink` | New idea: align on intent (3 questions) → split into nodes → mandatory reuse research (borrow before build) → fill how/why_this_way → design tests → weekly plan → wait for approval |
| `/ccbuild` | Implement in topological order: write the test, confirm it fails, implement, verify, mark done |
| `/ccfix` | Debug: first compare code against the graph line-by-line (is the code wrong or the idea stale?), only then question the idea itself with real inputs and outputs |
| `/ccgraph` | Render, validate, and report what is ready to work on |

`check` rejects: `done` without `code`/`verify`, `done` pointing at nonexistent files, cycles, nodes that reach no terminal, unsigned manual verification, and warns on a non-empty scan checklist.
