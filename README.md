# ai-companion

One gated idea-graph harness, shared by Claude Code, Cursor and Codex.

Every idea in a project is one node in `ideas/graph.yaml`. Every prerequisite is one edge. Product code cannot be written until the idea behind it is written down, approved by a human, and has a failing test to its name. If it is not in the graph, it is not tracked.

The point is not the graph. The point is that **the reasoning survives** — six months later the code says what it does, and the graph says why it is that way and what was rejected.

## One base, three harnesses

There used to be three implementations of this idea, one per agent, drifting apart. Now there is one:

```
companion/          the shared base — engine, rule core, three wirings, installer
  ideas.ts            the engine: parse, validate, topological frontier, status
                      transitions, evidence, HTML render, 17 subcommands
  guard.ts            the rule core: a normalized event in, an allow/deny out —
                      plus three thin normalize/encode pairs, one per host
  manifests.ts        which hook event calls which command, per host. No policy.
  install.ts          installer, with preflight, dry run and uninstall
  skills/             the five skills all three agents read
  FORMAT.md           the authoritative spec, including the D1–D35 decision table
```

All three agents run the **same single file** — `.companion/companion.mjs`, built from `companion/` by `node companion/build.mjs`. The only per-host difference is which event names map to it:

| | hook events | reply protocol |
|---|---|---|
| Claude Code | `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SessionStart` | exit 2 + JSON, anchored on `${CLAUDE_PROJECT_DIR}` |
| Cursor | `preToolUse`, `beforeShellExecution`, `beforeMCPExecution`, `afterFileEdit`, `beforeSubmitPrompt`, `stop`, `sessionStart` | flat permission JSON, `failClosed` on every blocking event |
| Codex | Claude-shaped events plus `apply_patch` | exit 2 + JSON, path resolved from the git root |

Change a rule once and all three change together. A table-driven contract test feeds the same scenario through all three hosts' raw payloads and asserts the normalized event and the verdict come out identical.

**Adding a fourth agent** is two functions and one manifest — roughly 120 to 190 lines with tests, and zero changes to the engine.

## Install

```bash
node companion/build.mjs                              # build the single-file artifact
npx tsx companion/install.ts <target-repo> --dry-run  # see every file and hook first
npx tsx companion/install.ts <target-repo>
```

It writes `.companion/companion.mjs`, the five skills (to both `.agents/skills/` and `.claude/skills/`), and merges hook entries into `.claude/settings.json`, `.cursor/hooks.json` and `.codex/hooks.json` — never clobbering another tool's entries. It refuses to run if it finds a previous generation's wiring (`--replace-legacy` to take it over), refuses to seed a graph over an un-migrated one, aborts rather than overwrite a config file it could not parse, and smoke-tests the guard before recording the install. `--uninstall` is a clean inverse.

Codex needs one manual step afterwards: run `/hooks` in Codex and trust the entries.

## The workflow — five skills

| Skill | What it does |
|---|---|
| `/ccscan` | Read the whole project — a hook-tracked checklist, not self-reported — then build the graph, render it, and stop for a human |
| `/ccthink` | A new idea: agree on intent, split into nodes, research what can be borrowed before building, fill in `how` and `why_this_way`, design the tests, wait for approval |
| `/ccbuild` | Implement in topological order: write the failing test, prove it is red, implement, verify green, close |
| `/ccfix` | Debug: compare the code against the idea line by line first — is the code wrong, or has the idea gone stale? — and only then question the idea, with real inputs and outputs |
| `/ccgraph` | Render, validate, report what is ready to start |

## The engine

```bash
node .companion/companion.mjs check       # validate; exit 1 on errors
node .companion/companion.mjs next        # what can be started now (the frontier)
node .companion/companion.mjs show I-014
node .companion/companion.mjs set I-014 done --by me --note "reason"
node .companion/companion.mjs render      # regenerate ideas/graph.html
node .companion/companion.mjs serve       # the graph page, with an edit-and-submit loop
node .companion/companion.mjs paths       # every path the engine will ever write
```

Seventeen subcommands in all; `paths`, `init`, `migrate`, `scan`, `new`, `check`, `status`, `next`, `show`, `log`, `set`, `allow`, `render`, `apply`, `serve`, `request-approval`, `run-check`. The guard's own allowlist is derived from that same table, so the two can never drift.

Read-only subcommands take `--file <graph>`, so a retired graph can still be inspected. State-changing ones refuse any graph but the project's own.

## What actually stops you

Seven rules, each adjudicated in `companion/FORMAT.md`:

- **Default deny (D16).** A product file that no build-ready `doing` idea claims is refused. That idea's declared `verify.test_files` are writable from the start, because writing the failing test is the legal first move (D8).
- **Two human approvals (D7/D17).** An idea reaches `doing` only with a current *decomposition* approval and a current *plan* approval. Each is a one-time challenge — the engine mints `CC-XXXXXXXX`, the human answers `批准 CC-XXXXXXXX`, and the receipt is bound to a hash of the approved content. Change one word of `how`, `code` or `verify` and the approval is void.
- **Test first, with evidence (D8).** Implementation is refused until `run-check` has recorded a real RED — the command ran and really failed. A timeout, a missing executable or an idea with no test files is an infrastructure error, never a RED.
- **The graph is prose, except two fields (R2/D27).** Rewrite any `why` you like. `status` moves only through `set`; `verify.signed_off` only through a manual-check challenge. Enforced by rebuilding the post-image and comparing the node list — for ordinary edits and for patches alike.
- **Shell is inside the wall (D21).** A redirect, `sed -i`, `git checkout`, an interpreter handed a script — all hit the same gate as the edit tools. Protected evidence is defended by its *path*, whatever command names it.
- **Unknown target means denied (D23).** A write whose destination cannot be determined is refused, not excused.
- **Fail closed (D9).** A guard that crashed proved nothing, and an irreversible write it failed to inspect cannot be un-written. Post-write recording fails open instead: a recorder bug must not block finished work.

Escape hatch: `AIDEV_GUARD=off` turns off all seven, and says so loudly in the log.

## Tests

```bash
npm test    # vitest run --dir .devcompanion/tests
```

42 files, 485 tests. Every rule above has at least one test that fails without it, and the security-shaped ones have a bypass probe written from the attacker's side.

## Layout

```
companion/       the shared base (above)
ideas/           the ledger: graph.yaml, log.md, graph.html, and .runtime/ evidence
.devcompanion/   the test suite
archive/         the three retired per-agent implementations, kept for reference
```

### `archive/`

`claude-companion/`, `cursor-companion/` and `codex-companion/` were the three separate implementations, plus their tests, launchers and command files. They are kept because the reasoning in them is worth reading and because `companion/FORMAT.md`'s decision table cites them by name — every divergence between the three was adjudicated one at a time, and the table records which one won and why.

Nothing in `archive/` runs. Nothing there is wired to a hook. Do not edit it, and do not copy from it without checking the decision table first: much of it lost, and lost for a recorded reason.
