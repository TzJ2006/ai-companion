# CLAUDE.md

Guidance for Claude Code working in this repository. Read `README.md` first for what the project is; this file is about working *inside* it.

## The shared base is live here

This repository runs its own product. `.claude/settings.json`, `.cursor/hooks.json` and `.codex/hooks.json` all point at `.companion/companion.mjs` — the single-file artifact built from `companion/`. The three per-agent implementations that preceded it are in `archive/` and nothing there is wired to anything.

So the rules in `README.md` under "What actually stops you" are not a description of someone else's repository. They are what will block you here, in this session, and they are deny-by-default. Two consequences worth internalising before you start:

- **You cannot edit a product file just because you know what to change.** It needs an idea in the graph, `doing`, with `how`, `why_this_way`, `code` and `verify` filled, a current decomposition approval, a current plan approval, and a recorded RED. That is the whole point; do not look for a way around it.
- **The human is the only source of approval.** The engine mints a challenge (`CC-XXXXXXXX`); a human answers `批准 CC-XXXXXXXX` in a message of their own. You cannot produce that, and shell is inside the wall (D21) so you cannot write the receipt either. When you need approval, ask and stop.

Editing the graph's prose is always allowed — that is deliberate. `status` and `verify.signed_off` are not: they move through `set` and through a manual-check challenge respectively.

Escape hatch, for when the guard is genuinely wrong: `AIDEV_GUARD=off`. It disables all seven rules and writes a `guard.disabled` line into the log. Use it when blocked by a bug, tell the human you did, and open an idea for the bug.

## The ledger

One graph, project-owned, no agent suffix:

```
ideas/graph.yaml        the plan — 59 ideas, migrated from graph.claude.yaml on 2026-09-02
ideas/log.md            append-only; every write the guard sees lands here
ideas/graph.html        rendered by `render`; the edit-and-submit page is `serve`
ideas/.runtime/         approval receipts and RED/GREEN evidence — CLI-only, never hand-written
```

`node .companion/companion.mjs paths` prints the full list. Never hand-create a path the engine owns, and never edit anything under `.runtime/`.

Two retired ledgers sit beside it as read-only migration inputs: `ideas/graph.claude.yaml` (the source of the migration) and `ideas/graph.cursor.yaml` (the 26-idea graph the retired Cursor implementation left on the canonical name, renamed out of the way on 2026-09-02). `ideas/migrate-report.md` records what the migration could not carry across losslessly. Read-only subcommands accept `--file` if you need to look at either; state-changing ones will refuse.

## Commands

```bash
npm test    # vitest run --dir .devcompanion/tests — 42 files, 485 tests
```

This is now safe to run. It was not, until 2026-09-02: `test_ideas_graph.test.ts` called the legacy installer's argument-less `updateAll()`, which walked a machine-local registry and re-installed into six unrelated repositories, rewriting their `.claude/settings.json` each time. That file is in `archive/tests/` and outside the test directory. If you ever move it back, that hazard comes back with it.

```bash
node .companion/companion.mjs check      # validate; exit 1 on errors
node .companion/companion.mjs next       # the frontier — what can be started now
node .companion/companion.mjs status     # what is in flight, what is blocked
node .companion/companion.mjs show I-014
node .companion/companion.mjs log I-014
node .companion/companion.mjs run-check I-014 --phase red
node .companion/companion.mjs request-approval --gate plan --node I-014
node .companion/companion.mjs render
```

`companion/` is where changes are made. `node companion/build.mjs` rebuilds the artifact — and until you do, this repository is still running the old bytes, so a change to `companion/guard.ts` has not taken effect on you yet. The installer's `--update` rebuilds and re-merges the wiring.

## Working on the base itself

This repository is the one place where the engine is also the product, which has two sharp edges:

- **A change to `companion/guard.ts` changes what blocks you**, one rebuild later. If you make the guard stricter, you may lock yourself out of finishing. Sequence the work so the rebuild is last.
- **Six other repositories on this machine run this same artifact** — `ErrorRecoveryBenchmark`, `LifeCopilot`, `LiveCaption`, `RoboMemory`, `TokenMonitor`, `gadget`. They have their own copy under `.companion/`, so an edit here does not reach them until someone re-installs; but `install.ts --update` walks the whole registry and updates all of them at once. Know which one you meant.

`companion/FORMAT.md` is the authoritative spec: the eight questions, the edges, the generated files, and the D1–D35 decision table recording how every divergence between the three retired implementations was adjudicated and why. **When a decision row and the code disagree, the code wins and the row is a bug — fix the row.** That drift is the single failure mode this project keeps rediscovering.

## `archive/`

The three retired implementations, their tests, launchers and command files. Nothing runs. Do not edit it; do not copy from it without checking the decision table first, because much of what is in there lost an argument on the record.

It is kept, rather than deleted, because the decision table cites it by name — a row that says "Codex did X, and here is why we did not keep it" is unreadable once X is gone.

## Known open items

- `package.json` still points its `graph` script at the archived engine, and has no `build` script. It is pending a human approval to edit.
- Three ideas are `doing` and signed in the browser but never closed: I-049, I-051, I-080.
- I-082 is `doing` while its prerequisite I-086 is `todo`, which the spec forbids and `check` does not catch.
- I-059 and I-075 are duplicate endpoints with identical prerequisites.
- Three worktrees under `.claude/worktrees/`. `vigorous-archimedes` is dirty with a `CLAUDE.md` rewrite that exists nowhere else; salvage before removing.
- `check` reports 11 warnings on the migrated graph — mostly unanswered planning questions and ideas no endpoint depends on. Worth a pass with `/ccgraph`.
