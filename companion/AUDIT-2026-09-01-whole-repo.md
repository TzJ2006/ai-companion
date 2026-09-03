# Whole-repository audit against the all-in-one companion vision

- Date: 2026-09-01, evening (after commit `14f7ade`, branch `main`)
- Scope: everything in `D:\GitHub\ai-companion` except `node_modules` and the three stale worktrees under `.claude/worktrees/`
- Nature: read-only. No product code, test, spec, or graph file was changed. See section 12 for the side effects the audit run itself caused.
- Vision being audited (the owner's words): one all-in-one companion that absorbs the strengths of the Claude Code, Codex, and Cursor versions; every harness, including future ones, keeps only a hook of its own; a change made once applies to all of them.
- Method: nine independent readers (one per subsystem), six batches re-verifying the 29 concrete claims made by the two earlier audits written today, one adversarial refuter per new blocker or high finding, one synthesizer, one completeness critic. 66 agents, 1512 tool calls. Every finding below that is marked "verified" survived a refuter that was told to disprove it by reading the code and, where possible, running the code against a temporary fixture.

---

## 1. Verdict

The shared base in `companion/` is real, tested, and shaped the way the vision needs: one pure rule core, one engine, three thin normalize/encode pairs, one bundle, five shared skills. That is the good news, and it is substantial.

Nothing runs it. This repository still enforces with the legacy Claude guard by absolute machine path, the legacy Cursor gate against a stale graph, and no Codex wiring at all. Six external repositories are in the same state. The shared base is installed nowhere.

Three things block making it the daily entry point, in this order:

1. **The shared base's own safety rules have holes that the implementations it replaces do not have.** Its change-file write-back can mark ideas done with no test evidence and forge manual signatures. Its shell screen lets an agent mint its own approval receipts. Its patch parser lets a Codex session create any product file. Its graph rule fails open for every patch-shaped or Model Context Protocol write. Each of these is closed in at least one of the three live implementations.
2. **This repository cannot migrate to it.** The canonical file `ideas/graph.yaml` is occupied by a 26-idea Cursor graph from 2026-08-24. The shared engine treats it as the project graph, and `migrate` refuses because the file exists. The live 59-idea plan lives in `ideas/graph.claude.yaml`. The migration idea I-073 as written does not apply here.
3. **The two engines have already forked, and the plan keeps forking them.** A human-reported bug fixed today in `claude-companion/ideas.ts` is absent from `companion/ideas.ts`. Fifteen test files, 208 of the 354 tests, still test the legacy engine. Four open ideas that are ready to build point their code fields at the legacy tree.

Against the six dimensions of the vision: single engine is partial, thin hook is mostly met inside the base, change-once is not met, a fourth harness is cheap in principle but taxed by five leaks, strengths are partially absorbed with a list of silent losses, and safe installation with rollback is not met.

Recommendation: do not install `companion/` into this repository or any registered repository yet. Close the guard and write-back holes first (they are small, well-located changes with clear tests), unblock the graph collision with one human rename, stop the engine fork, then run the real-product acceptance ideas I-073 and I-074 in a throwaway repository.

---

## 2. What is in the folder

| Path | What it is | State today | Size |
|---|---|---|---|
| `companion/` | The new shared base. `ideas.ts` engine, `guard.ts` rule core plus three normalizers and encoders, `manifests.ts` hook wirings, `install.ts`, `cli.ts`, `build.mjs`, `FORMAT.md` (the single spec with decisions D1 to D34), `skills/cc{scan,think,build,fix,graph}/SKILL.md` | Built and tested (115 tests). Not installed in any repository. `dist/companion.mjs` is gitignored and rebuilt by the test suite. | 2953 + 581 + 87 + 231 + 14 + 25 lines; spec 735 lines; skills 270 lines |
| `claude-companion/` | The live Claude Code implementation: engine, seven-rule guard, installer with registry, five slash-command sources, its own `FORMAT.md` and `README.md` | Live in this repository and six external ones. Hooks reference it by absolute path `D:/GitHub/ai-companion/...`. Authoritative engine for the web page, `apply`, and `serve`. | 2235 + 368 + 220 lines; spec 312; readme 392 |
| `cursor-companion/` and `.cursor/` | The live Cursor implementation: 624-line engine over a 224-line policy library, three hook scripts, four-mode installer, five `idea-*` skills plus `idea-record`, plugin and marketplace manifests. `.cursor/` is a byte-identical installed copy. | Live in this repository. Its gate reads `ideas/graph.yaml`, the stale Cursor graph, with 14 errors under its own engine and 11 ideas in `doing`. | about 1100 lines of engine and hooks |
| `codex-companion/` | The live Codex plugin: one zero-dependency Python engine, 14 unit tests, one skill with two reference documents, a demo fixture | Dormant here. No `.codex/` directory, no `.codex-companion/` state, no hook wiring at the root. Installs only through the plugin marketplace and a trust step. | 1807 lines Python; 506 lines tests; readme 935 lines |
| `ideas/` | The ledgers. `graph.claude.yaml` is the live plan (59 ideas, 0 errors, 10 warnings). `graph.yaml` is the stale Cursor graph (26 ideas, 9 errors under the shared engine, `agent: cursor`, `enforce`/`exempt` keys). `log.claude.md` is the live log. `log.md` is a stale mixed-origin file. Per-machine state is ignored correctly. | The live approval hash no longer matches the graph. | graph.claude.yaml 2638 lines; graph.yaml 811 |
| `.devcompanion/tests/` | 31 vitest files, 354 tests. 12 `test_base_*` files (115 tests) cover `companion/`. 15 files (208 tests) cover `claude-companion/`. 4 files (31 tests) cover `cursor-companion/`. The Codex Python suite is not wired into `npm test`. | All green. Two suites touch real machine state. | |
| `.claude/` | `settings.json` with four hook events by absolute path, five installed command copies with 22 absolute paths, three stale worktrees | Live wiring. Worktrees excluded only by `.git/info/exclude`. | |
| root | `package.json` (`test`, and `graph` pointing at the legacy engine), `graph.cmd` and `graph.sh` (legacy engine), `CLAUDE.md`, `.gitignore`, `.cursor-plugin/marketplace.json` | `CLAUDE.md` says the shared engine does not exist yet and that `paths` is a future command. Both are stale. | |
| untracked | `companion/AUDIT-2026-09-01.md` and `ideas/companion-unification-audit.md`, two audits written earlier today | Their claims are re-verified in section 7. | |

---

## 3. Where the plan stands

From `ideas/graph.claude.yaml`, validated by both engines with 0 errors:

| Idea | Role | Status |
|---|---|---|
| I-069 | Write the shared spec and decision table | done |
| I-088 to I-092, I-099 | Engine: suffix-free graph, readiness, approval, evidence, migrate, gap closures | done |
| I-093, I-094 | Rule core and three normalize/encode pairs | done |
| I-095 to I-098 | Skills, bundle, manifests, installer | done |
| I-070, I-071, I-072 | Milestones over the three groups above | done |
| I-073 | Cursor real-product cutover and migration | todo, on the frontier |
| I-074 | Codex real-product cutover and migration | todo, on the frontier |
| I-075 | Endpoint: three agents relay one graph; change once, three take effect | todo |
| I-059 | Endpoint: three agents share one graph | todo; duplicates I-075 |
| I-080 | Double-click entry to the graph page | doing since 2026-08-31, signed in the browser, never closed |
| I-082 | Spec: step overview | doing while its prerequisite I-086 is todo, which the spec forbids |
| I-049, I-051 | Manual checks | doing for eight days, signed in the browser, never closed |

The human approval on disk (`146f35b86bbb`) does not match the current graph hash (`d09386ce43f9`). The final `set` round after the last approval changed the graph. Any `/ccbuild` will be refused by rule R6 until someone types `批准` again.

Six done ideas record acceptance criteria the code does not meet. I-070 claims all 14 Codex unit-test guarantees were migrated (four have no counterpart). I-072's verify command points at `test_ideas_graph.test.ts`, which tests the legacy engine. I-093 claims status and signed_off are protected against hand edits (not for patch-shaped writes). I-094 claims every patch file is checked (Move-to is not parsed). I-095 claims the skill bodies are based on the Claude commands (they are 609 words replacing 3734). I-097 claims the session briefing is shared by three harnesses (it reaches one).

---

## 4. Scorecard against the vision

| Dimension | Score | Why |
|---|---|---|
| One engine, one rule core | partial | `companion/guard.ts` `decide()` is pure over a normalized event, and `decideProductWrite` in `companion/ideas.ts:834-881` is the single verdict behind both the guard and the `allow` command, proven by a test. But no harness runs it, the engines have forked, and 208 of 354 tests still test the legacy engine. |
| Each harness keeps only a thin hook | mostly, inside the base | Each harness is one normalize/encode pair of roughly 47 lines plus a 15 to 25 line manifest, and the adapters carry no policy. Five pieces of platform knowledge leak outside the adapters (section 9). The live wirings are not thin at all. |
| Change once, apply everywhere | not met | A change to `companion/` reaches no running harness. Even after an install, `--update` recopies files but never re-merges hook manifests or rebuilds the bundle. Two `FORMAT.md` files are co-edited by hand. The eight-question wording lives in three places inside the engine. The fork of today's fix is the proof. |
| A fourth harness is cheap | mostly | Two functions and one manifest, roughly 120 to 190 lines with tests, zero changes to the engine. But an unknown `--platform` silently falls back to Claude semantics, the engine path `.claude/companion/companion.mjs` is hardcoded into every skill body, and there is no story for a harness without hooks. |
| Strengths of all three absorbed | partial | Absorbed and tested: Codex's content-bound one-time approvals and RED to GREEN evidence, Cursor's readiness gates and default deny, Claude's scan checklist and web chain. Dropped without a recorded decision: a list of nine Codex guarantees, four Cursor features, and four Claude workflow safeguards (section 8). |
| Install without breaking the live setups, with rollback | not met | Installing into this repository would leave two guards on every event, point the new one at the stale graph, offer no dry run and no uninstall, silently replace an unparseable `settings.json` with `{}`, and leave hooks wired after a failed smoke test. |

---

## 5. Blockers, all verified

Each of these is latent today because nothing runs the base. Each becomes live the moment I-073 or I-074 wires a real harness.

### B1. The change-file write-back rewrites any field and marks ideas done with no evidence, and the guard whitelists it

`applyChanges` in `companion/ideas.ts` is the single write path behind both `apply` and the page's `serve` endpoint.

- `set` operations have no field whitelist. `companion/ideas.ts:1276` writes `op.field` verbatim. The whitelist `NEW_IDEA_FIELDS` at line 1167 is applied only to `add`. A change file with `{op: "set", field: "status", new: "done"}` marks a todo idea done with no transition check, no readiness, no approval, no RED, no GREEN, and no log line. Verified by running the pure function against a fixture.
- `status` operations call `setStatus` without a project directory at line 1267, which skips the GREEN gate at line 1129 by design. The comment at line 1103 says "the guard re-checks". The guard does not: `apply` writes the graph itself at line 2928 as a shell side effect, and the shell rule at `companion/guard.ts:219` whitelists `node ...companion.mjs apply`.
- `sign` operations at lines 1297 to 1322 write `verify.signed_off` directly from the change file, with no challenge. `FORMAT.md` records this at lines 647 to 655 as an unresolved conflict with decision D27. It is not only unresolved in prose, it ships in the base.
- Behaviour-field edits on a done idea demote it straight to `doing` at lines 1282 to 1290, bypassing the transition table.

Fix: whitelist `set.field` to the six prose fields plus `name`; pass the project directory into `setStatus` or refuse `to: done` from envelopes; turn `sign` into a manual-check challenge request; demote to `blocked`, not `doing`. Add one bypass test per operation. Prior audit claim E1 was partial on this point: signed_off is reachable only through the `sign` operation, not through `set`.

### B2. The Codex patch parser does not know `*** Move to:`, so a permitted edit to the log can be renamed into any product path

`companion/guard.ts:351` recognises `Add`, `Update`, and `Delete` headers only. Codex's `apply_patch` has a fourth directive, `*** Move to: <path>`. Every path under `ideas/` that is not protected evidence is unconditionally allowed at `companion/ideas.ts:857-859`. A patch that updates `ideas/log.md` and moves it to `src/evil.ts` is allowed, and the post-write record logs only `ideas/log.md`. Verified by probe. The live Python parser at `codex-companion/scripts/companion.py:68-73` has the same gap, so this is inherited, not a regression, but it is a full bypass of default deny on Codex.

Fix: capture `Move to` as an add operation on the destination, and deny any patch whose operation count differs from its header count, as the Python did at lines 1581 to 1582.

### B3. The shell screen lets an agent mint its own approval and run arbitrary mutating scripts

- `COMPANION_CLI` at `companion/guard.ts:219` has no subcommand allowlist, so the hook entry itself, `node ...companion.mjs guard --platform=x`, counts as a sanctioned command.
- Pipe, heredoc, and redirect forms such as `printf '{...UserPromptSubmit...}' | node .../companion.mjs guard` match neither the whitelist, nor `MUTATING_SHELL` at lines 206 to 214, nor `ONE_LINER_INTERPRETER` at line 216, and fall through to allow at line 239. With that, an agent can feed a synthetic prompt event carrying `批准 CC-XXXXXXXX` and write its own receipt, or self-sign a manual check.
- `ONE_LINER_INTERPRETER` blocks only `-c` and `-e`. `python script.py` and `node script.js` are allowed. `MUTATING_SHELL` has no `copy|move|erase` for `cmd.exe`.
- The Python screen closes all of these: a subcommand allowlist that excludes `hook` (`companion.py:88-94`), an explicit rejection of any other invocation mentioning the engine (lines 1571 to 1573), and a blanket interpreter block (lines 95 to 98, 1573 to 1575). Only the regex layer was ported.

Decision D26 credits Codex for closing "manual guard invocation simulates an event". The base reopens it while also bringing Bash inside the gate (D21), which makes the hole reachable from every harness.

---

## 6. High-severity findings, verified unless marked

### The shared base: guard and engine

- **H1. The graph rule fails open whenever the event has no edit body.** `companion/guard.ts:155` returns allow when `event.edit` is absent, and line 158 when the post-image cannot be computed. Codex `apply_patch` events carry operations and no edit (line 468). Cursor `ApplyPatch` and `EditNotebook` produce an edit object whose fields are all undefined. Every Model Context Protocol write on every platform sets no edit (line 343). So the protection of `status` and `signed_off`, the one field the spec singles out in D24 and D27, is enforced only for Claude-shaped `Edit` and `Write` calls. The Python implementation protected these fields at diff level (`companion.py:74-76`). Fix: when the target is the graph and no post-image can be derived, deny with "use `set`"; for patches, scan hunk lines for `^[+-]\s*(status|signed_off)\s*:`.
- **H2. PowerShell is in the Claude matcher but never normalized to a shell event.** `companion/manifests.ts:32` matches `Bash|PowerShell`; `companion/guard.ts:368` maps only `Bash`. A PowerShell `Set-Content src/x.ts` is classified `other` and allowed. Verified on both source and bundle. This is the shell this owner's machine speaks.
- **H3. Cursor and Codex hook commands are relative to the process working directory.** `companion/manifests.ts:54` and `:73` install `node .claude/companion/companion.mjs guard ...` with no anchor; only Claude gets `${CLAUDE_PROJECT_DIR}`. Codex documentation says project hooks run with the session working directory and warns that sessions may start in a subdirectory. Result: from a subdirectory, Codex gets `MODULE_NOT_FOUND`, exit 1, which Codex treats as non-blocking, so every write proceeds unguarded. Cursor at least has `failClosed`, so it denies everything loudly. The Python engine walked up to find the project root (`companion.py:176-187`); the base uses `raw.cwd` verbatim (`guard.ts:537`).
- **H4. Decision D17 is not implemented, and the decomposition approval is consumed nowhere.** `setStatus` at `companion/ideas.ts:1115-1122` admits `todo → doing` after readiness, prerequisites, and file-clash checks only. `validApproval` is called for `red-waiver` (line 810) and `plan` (line 867) and never for `decomposition`. The spec at `FORMAT.md:552-553` requires both approvals to be current at the transition. The test at `test_base_readiness.test.ts:138-140` enshrines the unapproved transition. Plan approval is enforced later at the first implementation write, so product code still cannot be written without a human, but the first of the two "real stop points" D7 justifies is ceremony.
- **H5. RED is granted for timeouts, missing executables, and ideas with no test files.** `runCheck` at `companion/ideas.ts:900-913` runs the command through a shell and marks every non-zero exit `red`, including status null after a timeout (stored as `-1`) and "command not found". `hashTests` at lines 765 to 772 records absent files as the string `missing`, and `redGateReady` accepts that. Readiness never requires test files. The Python engine refused all three (`companion.py:1136-1143`). One refuter lowered this to medium because the plan snapshot includes `verify` and GREEN is still required to close; another kept it high because 27 of the 42 command-verified live ideas have no `test_files`. Either way, a typo in `verify.command` opens the implementation gate.
- **H6. No table-driven contract test proves the three normalizers reach the same verdict.** `test_base_adapters.test.ts:57-74` is the only three-platform scenario, and it asserts one unclaimed write is denied. Claude and Codex `Bash` to shell, Codex `Stop`, Codex `UserPromptSubmit`, and post-write normalization for all three are never invoked in a test. Decision D22 promises exactly this fixture set.
- **H7. The scan checklist reports "84/84 read" while 35 files were never on it.** The worklist is built once and never reconciled with the live file list (`companion/ideas.ts:2718`, legacy `claude-companion/ideas.ts:2086`). The done count is `all.length - left.length`, so files added after the first scan, here the entire `companion/` directory and its twelve test files, count as read. The one number rule R7 exists to keep honest is false in both engines.
- **H8 (medium after verification). The session briefing absorbed from Cursor reaches only Claude.** `companion/manifests.ts:45-48` wires Claude `SessionStart` to `status`. Cursor `sessionStart` (line 65) and Codex `SessionStart` (line 84) go to the guard, whose normalizers have no session case, so Cursor receives `{}` and Codex nothing. The live Cursor `session.mjs` delivered a real briefing.
- **H8b (medium). Cursor's prompt reply mixes plain text and JSON on stdout.** `companion/guard.ts:551-558` prints the approval outcome as text for every platform, then the Cursor encoder appends `{"continue":true}`. Reproduced. Platform-shaped output leaked out of the encoder.
- **H9 (medium). `--file` gives an inconsistent view.** `set`, `new`, `apply`, `serve` write whatever `--file` names, including the suffixed legacy graph the base calls read-only; `applyApproval`, `migrate`, and the guard ignore `--file` and always use `ideas/graph.yaml`. So the CLAUDE.md-mandated way to run the base here today produces challenges that can never be answered. Prior audit claim V4 was partial on this point.

### The installer

- **H10. Installing into this repository, or any of the six registered ones, double-guards and points the new guard at the wrong graph.** `companion/install.ts:132` and `:149` strip only entries containing `.claude/companion/companion.mjs`, so the legacy absolute-path Claude hooks and the legacy Cursor `gate.mjs` survive beside the new ones. The seed at lines 88 to 93 is skipped because `ideas/graph.yaml` exists, so the new guard validates the stale 26-idea Cursor graph: every product edit denied, every Stop bounced with nine errors. No preflight, no `--dry-run`, no `--uninstall`.
- **H11. An unparseable host config is silently replaced by `{}` and rewritten.** `companion/install.ts:124-125` and `:142-143` catch the parse error, continue with an empty object, and write it back at lines 135 and 152. Here that would drop the `permissions.deny` list that forbids `rm -rf` and force pushes. The legacy installer it claims to inherit did not do this.
- **H12 (medium). Not transactional.** Files, three hook merges, and the graph seed are written (lines 75 to 98) before the smoke probe (lines 102 to 113). A failed probe throws and skips the registry, leaving a fully wired, unregistered install whose guard just proved it does not answer.
- **H13 (medium). Seeding before migrating makes `migrate` impossible in every repository with a legacy graph.** The seed never consults `findLegacySources`; `migrate` then refuses because `graph.yaml` exists. Five of the six external repositories have `graph.claude.yaml` beside a bare graph.
- **H14 (medium). `--update` neither re-merges hook manifests nor rebuilds the bundle**, so a manifest change never reaches installed repositories, and an engine change ships stale unless someone remembers `node companion/build.mjs`. There is no `build` script in `package.json`, and the root `.gitignore` line `dist/` swallows `companion/dist/`, so a fresh clone cannot install at all.

### This repository's own state

- **H15. The canonical path is occupied by a legacy graph the engine cannot recognise.** `ideas/graph.yaml` carries `agent: cursor` and `enforce`/`exempt` keys. `companion/ideas.ts` has no check for those keys outside `migrate`; `findLegacySources` at lines 933 to 944 looks only for suffixed files and Codex node directories; `migrate` at lines 1043 to 1046 refuses before looking. So `npx tsx companion/ideas.ts check` without `--file` reports nine missing-file errors with no hint that this is a legacy graph, and `migrate --dry-run` exits 1 with "已存在". I-073's `how` says "migrate graph.cursor.yaml"; no such file exists. This needs one human decision: rename the Cursor graph to `ideas/graph.cursor.yaml`, then `migrate --pick claude`. The engine should also learn to flag an `agent:`-stamped bare graph.
- **H16. The engines have forked.** Commit `80fa56a` fixed the draft-restore panel in `claude-companion/ideas.ts:1406-1418` twenty seconds before `14f7ade` created `companion/ideas.ts`, whose lines 2045 to 2051 still carry the pre-fix code, and so does the bundle. The rendered page at `companion/ideas.ts:2292` still tells users to run `npx tsx claude-companion/ideas.ts apply`. The ledger schedules I-085 and I-086 onto `claude-companion/ideas.ts`, I-087 onto `claude-companion/commands/*.md`, and I-082 onto both `FORMAT.md` files.
- **H17. `npm test` deploys the legacy installer into six external repositories.** `test_ideas_graph.test.ts:336` calls `updateAll()` with no registry argument; `claude-companion/install.ts:124` hardcodes the real registry; `updateAll` reinstalls into every registered target. Confirmed by this audit's own run: `.claude/settings.json` in TokenMonitor, LifeCopilot, and gadget carry modification times of 18:40:00, two seconds after the suite started. Content is idempotent today. After any repository switches to the bundle, every test run will re-add the legacy `guard.ts` hooks beside the new ones.
- **H18 (medium). The live approval is stale and the live hook wiring is machine-bound.** Four hook commands in `.claude/settings.json` and 22 lines in `.claude/commands/*.md` hardcode `D:/GitHub/ai-companion/...`. On any other machine the legacy guard fails silently open. The base's manifests already fix this and are not applied here.

### The live implementations

- **H19. Live Claude guard: three rules are inert for files whose first claimant is done.** `claude-companion/guard.ts:122-125` resolves the owning idea with `find`, and line 220 returns allow when that idea is done. In the live graph the first claimant of `claude-companion/ideas.ts` is I-042 (done) while I-061, I-085, I-086 are open; the same for `guard.ts` (I-047 first), `.claude/settings.json` (I-056 first), `companion/install.ts`, and both `FORMAT.md` files. Test-first, thought-through, and human approval are silently skipped for exactly the files that matter, and the log attributes every edit to the done idea.
- **H20. Live Claude guard: an unparseable graph switches all seven rules off**, including the Stop rule (`guard.ts:79-84`, `:171-172`, `:314-315`). Two edits, one that corrupts the graph and then any product edit, bypass everything without a warning. The base reverses this direction (D9).
- **H21. Live Claude guard: Bash is outside the gate and `Bash(npx tsx:*)` is pre-allowed**, so the approval file and scan lists are forgeable from the shell. The README admits it at lines 237 to 240. I-066 plans the fix and is todo.
- **H22. Live Cursor gate: suffix matching over-unlocks, including across drives.** `cursor-companion/gate-lib.mjs:125-131` accepts any path ending in `/` plus the claimed file, so a ready `doing` idea claiming `x/y.ts` unlocks every `**/x/y.ts`, and on Windows a same-suffixed path on another drive passes the outside-project check. Verified by probe. The live harness lock is also defeatable: the always-writable graph carries the `enforce` switch, and `ideas.ts enforce off` is ungated.
- **H23 (medium). Live Cursor and Codex lose features in the base without a recorded decision**: Cursor's `log` subcommand (D28 still promises it), `idea-record`, the always-apply rule, the plugin manifests; Codex's Stop rule that blocks an unfinished active node, semantic-record freshness (`recorded_seq`), done line-range validation (D32 adjudicated, unimplemented), the skipped-file list with reasons (D29), planning-depth fields, and the manual-only red-waiver.

### Tests, spec, skills

- **H24. 208 of 354 tests test the engine slated for deletion**, and the base's ported `applyChanges`, `render`, `serve`, `topoOrder`, `createLedger`, and `browserCommand` have no base tests beyond a two-assertion smoke check. `test_settings_hooks.test.ts` and `test_companion_gate.test.ts` read live repository state and will go red on migration for reasons unrelated to any regression. The base's own `test_base_install` asserts the real registry file must not exist, so the first genuine install turns the suite red.
- **H25. `claude-companion/FORMAT.md` is an actively co-edited twin that contradicts the shared spec** on how a manual check is signed (a human writes `signed_off` by hand versus D27's challenge), whether test paths are explicit (no `test_files` versus D2), and who owns the graph (suffix rule versus D10). The five installed commands tell every agent in seven repositories to read it first.
- **H26. The shared skills replaced rather than merged the legacy workflow text.** `ccfix` dropped the mandatory "stop, show the human the line-referenced mismatch list, end your turn" step that all three predecessors required. `ccscan` dropped the anti-fabrication rules (write `why_this_way: null` rather than invent, code must resolve, no invented test command). No skill handles arguments, so `/ccbuild I-014` and `/ccscan --refresh` have no defined behaviour. All five hardcode `node .claude/companion/companion.mjs`, and `test_base_skills.test.ts:56` enforces that string under the label "neutral".
- **H27 (medium). Spec-to-code drift inside the base, beyond the items above**: `FORMAT.md` header still says the authoritative engine is `claude-companion/`; D11's single-source wording appears in three variants inside the engine; D28's `log` command does not exist and the usage string omits `migrate`, `run-check`, `request-approval`; D31's path rules (no `..`, no absolute, restricted glob) are not enforced, so a plan can claim a file outside the project and the guard honours it; D32's line ranges are only a warning when absent, never validated, and `test_base_engine.test.ts:40` asserts `lines: "1-20"` on a one-line file passes; D30's atomic write covers only `save()`, while evidence, receipts, `migrate`, `apply`, and `serve` use plain writes, and `set`/`new` have no read-time digest; the step-overview section is unimplemented (I-085 todo) but presented as current; `check()` never consults GREEN evidence although `FORMAT.md:318` says it does.

---

## 7. The two earlier audits: what held

All 29 concrete claims were re-verified from code. 23 confirmed, 6 partial, 0 refuted.

| Claim | Verdict | Correction where partial |
|---|---|---|
| Graph rule allows without an edit body (G1) | confirmed, broader | Also Cursor `ApplyPatch`/`EditNotebook` and every Model Context Protocol write |
| PowerShell not normalized (G2) | confirmed | |
| Cursor/Codex SessionStart go to the guard (G3) | confirmed | |
| Cursor prompt reply mixes text and JSON (G4) | confirmed | Exactly one path: a `beforeSubmitPrompt` whose whole text is a challenge answer |
| Relative engine path breaks from a subdirectory (G5) | partial | Code confirmed; host behaviour is documented, not tested here. Codex documentation says session cwd, so Codex fails open, Cursor fails closed |
| Codex encoder never says `ask` (G6) | confirmed | |
| `set.field` unrestricted and direct `sign` (E1) | partial | Any top-level key via `set`; `signed_off` only via the `sign` operation; approval receipts are files the change file cannot touch |
| `set doing` checks no approval (E2) | confirmed | |
| No compare-and-swap in `set`/`new` (E3) | confirmed | |
| No `steps` validation, no `next_id` in either graph (E4) | confirmed | |
| No `log` subcommand, usage incomplete (E5) | confirmed | |
| Non-zero exit is always RED (V1) | confirmed | |
| `migrate` moves nodes only, not evidence (V2) | confirmed | |
| `migrate` refuses on bare `graph.yaml`, cannot see it is legacy (V3) | confirmed | |
| Legacy graphs are read-only (V4) | partial | Only against hook-mediated writes and `allow`; the engine's own commands write any `--file` |
| D31 glob unimplemented (S1), D32 lines unimplemented (S2), header stale (S3), I-072 verify wrong (S4), D27 unresolved (S5) | all confirmed | |
| Installer merges without backup or rollback (I1) | confirmed | |
| Seed before smoke leaves half-install (I2) | partial, worse | Everything is written before the smoke; failure leaves a fully wired, unregistered install; the seed blocks `migrate` regardless of smoke |
| Invalid JSON becomes `{}` (I3), double guard on this repo (I4), skills hardcode `.claude/` path (I5), `dist/` ignored and registry not ignored (I6) | all confirmed | |
| 80fa56a fix missing from base (D1) | confirmed | |
| Apply/serve/render tests import the legacy engine (D2) | partial | `render` has one string-containment test on the base; everything browser-side is legacy-only |
| Old guard suite cannot serve as base regression (D3) | partial | It asserts default-allow, not crash behaviour; it also imports symbols the base lacks |
| Live matchers narrower than the base (D4), launchers point at legacy (D5), function-level divergence (D6) | all confirmed | Only in `claude-companion`: `AGENT`, `nameIsTaken`, `agentName`. Only in `companion`: 48 top-level declarations |

One claim of the first audit was implicitly refuted: "there is no proof the verify command was approved with the plan". The plan snapshot at `companion/ideas.ts:626` includes `verify`, so editing the command invalidates the plan approval. The command still runs before that matters, which is finding H5's territory.

---

## 8. Strengths: absorbed, rejected by decision, lost by omission

| Source | Absorbed, with tests | Rejected by a recorded decision | Lost, no decision recorded |
|---|---|---|---|
| Claude Code | Diff-aware graph rule extended to `signed_off`; scan checklist with content fingerprints; Stop runs `check`; atomic comment-preserving YAML; the whole page, change file, `apply`, `serve` chain (copied nearly verbatim, untested in the base); mermaid and ledger shipped as one string | Whole-graph approval by a bare `批准` replaced by content-bound challenges (D7, D26); unclaimed-file default allow (D16); fail-open on crash (D9) | The `80fa56a` draft-panel fix; `ccfix` stop-for-human; `ccscan` anti-fabrication rules; `$ARGUMENTS`; the owning idea's name on each log line |
| Cursor | Readiness gates before `doing`; default deny; `allow`, `paths`, `status`; `failClosed` wiring; atomic save with retry; merge-never-clobber hooks; multiple `doing` without file overlap; Agent Skills as the carrier | Agent-suffixed ledgers (D10); `enforce`/`exempt` in the graph (D25); suffix and guessed-path matching (D31); `--force` (D20); copy/link/global/plugin install modes (D14) | Session briefing (reaches Claude only); `log` subcommand (D28 promises it); `idea-record`; always-apply rule; plugin and marketplace manifests; `--all` and parallel-subagent notes; the Cursor read event for scan striking |
| Codex | One-time content-bound approvals with receipts; RED to GREEN with a change counter; fail-closed direction; per-file patch parsing; the shell regex layer; encoder never `ask`; READY marker; Kahn order that keeps cycles as data; node-JSON migrator | JSON per node (D1); eight states (D4); slug ids (D5); NDJSON log (D13); single active node (D18); `code_refs.role`; multi-verification; the render-fingerprint handshake (I-070 log) | Diff-level protection of lifecycle fields in patches; shell-free `run-check` refusing missing executables and empty test lists; the subcommand allowlist and interpreter block; `find_root` walk-up; Stop blocks an unfinished node; semantic record freshness; done line-range validation (D32); skipped list with reasons (D29); planning-depth fields; manual-only red-waiver; the `intent` gate (dropped by omission, not listed in the "not absorbed" note) |

---

## 9. What a fourth harness costs today

Additive work, roughly 120 to 190 lines including tests:

1. `companion/guard.ts`: a `normalizeX` and `encodeX` pair next to lines 363 to 505 (40 to 70 lines), registered in the two maps at lines 521 to 522; the `Platform` type derives from them. Extend `RawHook` at lines 294 to 308 if the host's field names differ.
2. `companion/manifests.ts`: an `xHooks()` next to the three existing ones (15 to 25 lines).
3. `companion/install.ts`: one import, one merge call, one message, and the owned-files list if the harness reads skills elsewhere (4 to 10 lines).
4. Tests: normalize and encode cases, the same-verdict scenario, a manifest portability check, an install check (50 to 80 lines).
5. `FORMAT.md`: a row each in D14, D15, D22.

Zero changes to `ideas.ts`, `cli.ts`, `build.mjs`. That is the shape the vision asks for.

Five things turn "two functions and a manifest" into "two functions, a manifest, and five edits to the core":

- The approval outcome is written as plain text in `runGuard` for every platform (`guard.ts:551-558`) instead of travelling inside the verdict for the encoder to place.
- The session briefing is a Claude-only manifest special case (`manifests.ts:45-48`), not a normalized `session` event.
- The scan strike is keyed on raw Claude field names `PostToolUse` and `Read` outside the normalizer (`guard.ts:559-565`).
- An unknown `--platform` silently falls back to Claude semantics (`guard.ts:539-540`), so a typo in a manifest fails open with Claude's exit codes that another host ignores.
- The engine path `.claude/companion/companion.mjs` is hardcoded in the manifests, all five skill bodies, and the skills test, so a Cursor-only, Codex-only, or future install grows a `.claude/` directory, and relocating the engine touches eight files.

Two assumptions are unexamined: that every future harness has pre-write, shell, prompt, and stop hooks (an API-driven agent or a continuous-integration bot has none, and there is no fallback such as a git pre-commit hook or a command-line-only mode), and that Node is present (D34 says to check and fail clearly; the installer does not).

---

## 10. Recommended order of work

1. **Close the base guard's holes** (B2, B3, H1, H2). Parse `Move to`; deny graph writes with no post-image; give the whitelist a subcommand allowlist that excludes `guard` and reject pipe and redirect forms; port the interpreter-script block and `copy|move|erase`; route `PowerShell` to the shell event. One bypass test each. Files: `companion/guard.ts:153-158, 206-240, 351-359, 368, 460-468`.
2. **Make the write-back honour the gates** (B1). Whitelist `set.field`; pass the project directory into `setStatus`; turn `sign` into a challenge request; demote to `blocked`. Port `test_ideas_apply` to the base and add the bypass cases. Files: `companion/ideas.ts:1167, 1259-1322, 2907-2937`.
3. **Unblock this repository's graph** (H15). Teach `findLegacySources` and `check` to recognise an `agent:`-stamped bare graph; skip the installer seed when legacy sources exist; carry `log.<agent>.md`, `.scan-done`, and receipts or at least report them as left behind. Then, as a human step, rename `ideas/graph.yaml` to `ideas/graph.cursor.yaml` and run `migrate --pick claude`. Correct I-073's `how`.
4. **Make the installer safe to point at a live repository** (H10 to H14). Preflight for legacy wiring with an explicit `--replace-legacy`; `--dry-run`; `--uninstall`; abort on unparseable JSON; smoke before merge or restore on failure; check Node first; make `--update` rebuild and re-merge; add a `build` script; ignore `companion/.installs.json`.
5. **Stop the fork** (H16). Port the `80fa56a` hunk and its test; fix the page instruction; retarget the fifteen legacy test files at `companion/ideas.js`; repoint the `code` fields of I-085, I-086, I-087, I-082, I-061, I-066, I-067; switch `package.json`, `graph.cmd`, `graph.sh` to the bundle; add a rule to `FORMAT.md` that `claude-companion/` is frozen except same-day mirrored hotfixes; reduce `claude-companion/FORMAT.md` to a pointer.
6. **Stop `npm test` deploying** (H17). Injectable registry path in `claude-companion/install.ts`; temporary registry in the test; prune the five temporary-directory entries and this repository from the legacy registry before any base install; add a `test:base` script.
7. **Move the remaining harness-specific behaviour into the normalized model** (section 9). Add `session` and `read` event kinds; carry the prompt outcome in the verdict; reject unknown platforms with exit 2; resolve the project root by walking up from the working directory or anchor on the git root; pick a neutral engine path referenced from one constant.
8. **Restore Codex's evidence rigour** (H5, D31, D32). Classify spawn errors, timeouts, signals, and exit 127 or 9009 as `infra_error` that never satisfies the RED gate; require at least one existing test file for automated verification; validate `start-end` ranges against file length for done ideas; reject `..` and absolute paths; warn on `doing` ideas with unmet prerequisites.
9. **Resolve D7 and D17 one way** (H4). Either require both approvals in `setStatus` when a project directory is given, updating `ccbuild` and the two tests, or amend D17 to say plan approval gates the first implementation write and give the decomposition gate a consumer or delete it.
10. **Restore the skill safeguards and the command surface** (H26, D28). Put back `ccfix`'s mandatory stop with line references, one fix at a time, three attempts then blocked; port `ccscan`'s anti-fabrication rules; add an arguments section; implement `log` or strike it from D28; regenerate the usage string from the case list.
11. **Make the scan checklist honest** (H7). Reconcile the worklist against the live file list on every run; count done from struck entries; drop `codex-companion/` and `cursor-companion/` from `.scanignore`.
12. **Build the executable proof of the vision** (H6). A table-driven contract test that feeds each scenario through all three raw fixtures and asserts identical normalized events and verdicts; a conformance file with one `describe` per decision row; a spawn test of the guard entry for every platform. Reopen or annotate the done ideas whose expected is currently false: I-070, I-072, I-093, I-094, I-095, I-097.

Then, and only then, I-073 and I-074 in a throwaway repository, then I-075.

---

## 11. Hygiene backlog

None of these block the vision. All are cheap.

- The approval on disk is stale. Re-approve before the next `/ccbuild`. Run one session at a time; `log.claude.md:771` records two concurrent sessions invalidating each other's approvals.
- Three `doing` ideas were signed in the browser and never closed: I-049, I-051 (eight days), I-080. Decide D27, then `set done`.
- I-082 is `doing` with prerequisite I-086 todo. Neither engine's `check` notices a `doing` idea with unmet needs.
- I-059 and I-075 are duplicate endpoints with identical prerequisites. Merge or make one a prerequisite of the other.
- Three worktrees under `.claude/worktrees/`. `interesting-hodgkin` and `vigorous-archimedes` sit on commits already in main; `vigorous-archimedes` is dirty with a `CLAUDE.md` rewrite (+44/-31) that fixes the stale instructions and exists nowhere else. `fervent-jemison` is one commit ahead (`c30aeae`, "visible message before confirm" in the command files), but main already carries newer `ccscan.md` text. Salvage the `CLAUDE.md` diff, then remove all three and the merged branches.
- A phantom gitlink at `claude-companion/.claude/worktrees/serene-thompson-f1fc41` (mode 160000, no `.gitmodules`, empty on disk) is committed and appears in the scan lists as if it were a file.
- Stray tracked `claude-companion/ideas/log.md` (one line from a guard run with the wrong project directory). Stale mixed-origin `ideas/log.md`.
- `ideas/.scanignore` excludes `codex-companion/` and `cursor-companion/` for a reason the project reversed on 2026-08-29, and carries a `huashu-nuwa` path that no longer exists.
- `.gitignore`: `dist/` swallows `companion/dist/`; `companion/.installs.json` is not ignored; `ideas/.gitignore` lacks `.runtime/` and `changes.json`, and the installer never repairs an existing ignore file.
- No `.gitattributes`; `core.autocrlf=true`; `log.claude.md` is 772 CRLF lines and 31 LF lines. The index is clean LF. One line `* text=auto eol=lf` plus `*.cmd eol=crlf` fixes it.
- `test_ideas_scan_concurrency.test.ts:105` contains a literal NUL byte, so git treats the file as binary.
- Committed absolute machine paths: `.claude/settings.json` (4), `.claude/commands/*.md` (22), the Codex demo fixture's `log.ndjson` and `runtime/project.json`. `claude-companion/example/graph.html` (38 KB, generated) is tracked while every other rendered page is ignored.
- `CLAUDE.md` says the shared engine has not landed, that `paths` is a future command, and that `settings.json` references `packages/hook/dist/*`. All three are false. The auto-memory file for this project still says never to touch `codex-companion/` or `cursor-companion/`; that ban was lifted on 2026-08-29.
- `cursor-companion/gate-lib.mjs` has a UTF-8 byte-order mark and two mojibake `?` where dashes were, in user-facing deny messages. `record.mjs`'s skip pattern never matches `.git/` or `.cursor/companion/`.
- The rendered `graph.html` embeds the absolute project path in a `data-project` attribute.
- Both the live Claude guard and the base's recorder log writes to paths outside the project into the change log (see section 12).

---

## 12. What this audit did to the working tree

The audit was read-only by instruction, but two things touched state:

1. **The initial `npm test` run rewrote `.claude/settings.json` and the five command files in six external repositories** (ErrorRecoveryBenchmark, LifeCopilot, LiveCaption, RoboMemory, TokenMonitor, gadget) through the legacy installer's real registry, appended five temporary-directory entries to `claude-companion/.installs.json`, and rebuilt `companion/dist/companion.mjs`. Content in the external repositories is byte-identical to before; only modification times changed. This is finding H17 observed first-hand.
2. **Six lines were appended to `ideas/log.claude.md`** by the live Claude guard's rule R1, recording scratchpad probe files that verifier agents wrote outside the repository. The lines are noise. They were left in place because the log is append-only by the project's rules; `git checkout ideas/log.claude.md` removes them if you prefer.

No file under `companion/`, `claude-companion/`, `cursor-companion/`, `codex-companion/`, `.devcompanion/`, or `ideas/graph*.yaml` was modified.

---

## 13. Method and limits

- Nine readers each read one subsystem in full and returned structured findings with `path:line` evidence. Every finding rated blocker or high was handed to a separate refuter instructed to disprove it from the code, and where feasible by running the code against a temporary fixture. Findings rated medium or low were accepted without a second reader and are marked so above where they appear.
- The 29 concrete claims of the two earlier audits were re-verified in six batches by readers who were told not to trust those documents.
- A synthesizer scored the six vision dimensions from the verified data. A completeness critic listed unread files, unsupported claims, and contradictions between readers, and spot-checked the five most consequential findings; it agreed with all five.
- Not done: no real Cursor or Codex session was driven (that is I-073 and I-074); the base was not installed into a throwaway copy of this repository, so the double-guard state is inferred from code rather than observed; hook latency was not measured; concurrency of two harnesses on one graph was not exercised; whether Cursor discovers `.agents/skills` and which tool names Cursor and Codex actually emit remain assumptions the repository holds no fixtures for.
- Readers disagreed on severity in three places (write-back bypass, bogus RED, PowerShell). The stricter reading is used above where the finding is the base's own sanctioned path, and the milder one is noted where the disagreement is only about weighting.
