---
name: cconboard
description: >-
  Codebase onboarding skill that transforms existing code into modular, tested,
  documented code with full audit trail. Phases: (0) scope & archive originals,
  (1) AST scan & inventory, (2) LLM function analysis (why/what/how + classify
  pure/adapter/orchestrator + detect side effects), (3) characterization tests
  before any change, (4) risk-tiered restructure plan, (5) execute by tier with
  forced log+test per modification, (6) post-refactor tests (100% coverage target),
  (7) verify & report, (8) handoff with feature guards.
  Every modification writes a log entry and requires passing tests.
  Original code archived before any change.
  TRIGGER when: user says "onboard", "clean up", "modularize", "make testable",
  "refactor for tests", "understand this codebase", or /cconboard.
  DO NOT TRIGGER when: user wants a new feature (use /ccplan), has a failing
  test to fix (use /ccdebug), or wants a one-line change.
origin: custom
---

# /cconboard — Codebase Onboarding

## Core Premise

Transform an existing codebase into modular, tested, documented code through
incremental, safe, logged transformations. Every change is archived, logged,
and verified by tests. No code is modified without a characterization test
locking its current behavior first.

## When to Use

- Joining a new project
- Taking over unmaintained code
- Preparing code for team collaboration
- Making legacy code testable and understandable

## Conversation Loop Protocol

1. On invocation: read OL document status (if exists) to determine current phase
2. If resuming: pick up from last recorded status
3. If new: start Phase 0
4. Advance through phases continuously — do NOT stop between phases
5. Only pause for: user input needed (medium-risk confirmations), or explicit user pause
6. After each phase: update OL document status on disk

---

## Phase 0: SCOPE & SNAPSHOT

**Goal**: Define what we're onboarding and create a safety net.

**Steps**:
1. Determine scope from user input:
   - No argument → entire project root
   - Directory path → that directory recursively
   - File path → single file
2. Create archive directory: `archive/<ISO-timestamp>/`
3. Copy all files in scope to archive (preserving directory structure)
4. Record `manifest.json` in archive: `{files: [...], git_sha, scope, created}`
5. Initialize Onboarding Log (OL) at `.devcompanion/onboard-logs/<scope-slug>.yaml`
6. Set OL status: `phase-0-complete`

**Output**: Archive created, OL initialized.

**Tools**: Bash (cp, mkdir), Write (manifest.json, OL yaml)

---

## Phase 1: AST SCAN & INVENTORY

**Goal**: Build a complete map of every function in scope.

**Steps**:
1. Call existing `parseFileAuto` from `@aidev/ast` on every source file in scope
2. For each function/method found:
   - Record: name, hash (via `computeFunctionIdentity`), file_path, start_line, end_line, params, return_type, is_async, is_exported
3. For each class: record name, methods list
4. For each file: record imports, exports, line count
5. Write inventory section to OL document
6. Set OL status: `phase-1-complete`

**Output**: Complete function inventory in OL.

**Reuse**: `packages/ast/src/` (parseFileAuto, computeFunctionIdentity, getSupportedExtensions)

---

## Phase 2: FUNCTION ANALYSIS

**Goal**: Understand every function's purpose, classify it, detect problems.

**Steps**:
1. For each function, run analysis (via `analyzeBatch` from `@aidev/core`):
   - `why` — motivation/responsibility
   - `what` — capability/contract
   - `how` — algorithm/strategy
2. Classify each function:
   - `pure` — no side effects, deterministic output from inputs (belongs in utils-like location)
   - `adapter` — interfaces with external systems (filesystem, network, database, env vars)
   - `orchestrator` — coordinates multiple functions, manages flow
   - `mixed` — does multiple things, candidate for splitting
3. Detect side effects per function:
   - `filesystem` — reads/writes files
   - `network` — HTTP calls, sockets
   - `env_var` — reads process.env
   - `time` — uses Date.now(), setTimeout
   - `global` — accesses global/window state
   - `singleton` — uses getInstance patterns
4. Detect god functions: line_count > 50 AND multiple responsibilities
5. Write diagnosis section to OL document
6. Store analysis in `.devcompanion/analysis.json` (via existing AnalysisStore)
7. Set OL status: `phase-2-complete`

**Output**: Every function has why/what/how + category + side_effects in OL.

**Reuse**: `packages/core/src/analysis/` (analyzeBatch, analyzeHeuristic)

---

## Phase 3: CHARACTERIZATION TESTS

**Goal**: Lock current behavior BEFORE any modification.

**CRITICAL**: No code modification is allowed until this phase completes.

**Steps**:
1. For each function in scope:
   - Generate a characterization test that captures current input→output behavior
   - Test file: `.devcompanion/tests/char_<module>_<functionName>.test.ts`
   - Include both normal case AND edge case (empty input, null, boundary values)
2. Use LLM to write meaningful assertions (not just "toBeDefined"):
   - Read function source body
   - Read the Phase 2 analysis (why/what/how)
   - Generate test with realistic inputs and specific expected outputs
3. Run all characterization tests
4. Record results:
   - Passing tests: baseline locked
   - Failing tests: record as "known failures" (function may have existing bugs)
5. Write characterization_tests section to OL
6. Set OL status: `phase-3-complete`

**Output**: One test file per function, all run, results recorded.

**Reuse**: `packages/core/src/test-gen/` (generateTestSkeleton, buildLlmEnhancePrompt)

---

## Phase 4: RESTRUCTURE PLAN

**Goal**: Decide what to change and how, with risk classification.

**Steps**:
1. Based on Phase 2 diagnosis, generate modification items:
   - `mixed` functions → `extract_function` (split responsibilities)
   - God functions → `extract_function` (mandatory)
   - Untyped functions → `add_types`
   - Undocumented functions → `add_docstring`
   - Functions with hidden deps → `inject_dependency`
   - Large files with mixed concerns → `split_module`
2. Assign risk level to each item:
   - **low**: add_types, add_docstring, extract_function (if original export unchanged)
   - **medium**: extract_function (changes exports), move_file, inject_dependency, split_module
   - **high**: change_api, restructure
3. Determine execution order (dependency DAG):
   - Leaf extractions first (no other items depend on them)
   - Parent restructures last
4. Evaluate directory structure:
   - If original structure is reasonable → keep it, only do function-level improvements
   - If chaotic → suggest reorganization to utils/features/ pattern (as high-risk item)
5. Write restructure_plan section to OL
6. Present plan summary to user (counts by risk level)
7. Set OL status: `phase-4-complete`

**Output**: Ordered list of modifications with risk levels in OL.

**Risk Assignment Rules**:
- Low = does NOT change runtime behavior, does NOT require changes to any other file
- Medium = changes interface but all affected files can be enumerated
- High = blast radius is large or uncertain

---

## Phase 5: EXECUTE (by tier)

**Goal**: Apply modifications safely, one at a time, with full logging.

**CRITICAL PROTOCOL — For EVERY modification**:

```
BEFORE:
  1. Check: does characterization test exist for this function? (must be yes)
  2. Check: feature guards (if ECL exists, verify no guard is violated)
  3. Record before_content in OL execution_log

MODIFY:
  4. Apply the change

AFTER:
  5. Run characterization test for this function
  6. If PASS: record after_content, status=completed in OL
  7. If FAIL: IMMEDIATELY revert, record status=reverted, escalate risk level
  8. Write ChangeRecord via HistoryStore.saveSession()
  9. Update function hash in index.json
```

**Execution by tier**:

- **Low-risk items**: Execute automatically following the protocol above
- **Medium-risk items**: 
  1. Generate and display the unified diff
  2. Use AskUserQuestion: "Apply this change? [Yes/No/Skip]"
  3. On Yes: execute with protocol
  4. On No/Skip: record status=skipped in OL
- **High-risk items**: 
  1. Write as pending item in ECL document
  2. Log: "Requires /ccplan for full planning"
  3. Do NOT execute

**Progress reporting**: After each item, print status line:
```
[OB-001] extract_function | low | DONE ✓
[OB-002] add_types | low | DONE ✓  
[OB-003] split_module | medium | WAITING confirmation...
```

Set OL status: `phase-5-complete` (or `phase-5-waiting-confirmation` if paused)

**Output**: Modified code, execution log in OL, ChangeRecords in history.

---

## Phase 6: POST-REFACTOR TESTS

**Goal**: Write complete test coverage for the new clean structure.

**Steps**:
1. For each function in the (now refactored) scope:
   - Generate test file: `.devcompanion/tests/test_<module>_<functionName>.test.ts`
   - Normal cases (3-5 per function): happy path with realistic data
   - Edge cases (2-3 per function): empty input, null, boundary, large input, error paths
2. Use Phase 2 analysis to inform test design:
   - `throws` → generate error expectation tests
   - `inputs[].constraints` → generate boundary tests
   - `side_effects` → mock side effects in tests
3. Run all new tests
4. **Target: 100% function coverage** — every function must have at least one test
5. If coverage gap: generate additional tests until covered
6. Write post_refactor_tests section to OL
7. Set OL status: `phase-6-complete`

**Output**: Complete test suite for refactored code.

---

## Phase 7: VERIFY & REPORT

**Goal**: Confirm everything works and produce a visual report.

**Steps**:
1. Run full test suite: characterization tests + post-refactor tests
2. If all pass:
   - Generate HTML report via existing render pipeline
   - Report shows: function cards with why/what/how, side effects, test status
3. If failures:
   - Classify: is it a refactoring regression or a pre-existing bug?
   - Regression → route to revert + retry in Phase 5
   - Pre-existing → record as known issue
4. Write verification section to OL
5. Set OL status: `phase-7-complete`

**Output**: HTML report, all tests passing (or known issues documented).

**Reuse**: `packages/render/` (renderOnboardHtml), `scripts/generate-report.ts`

---

## Phase 8: HANDOFF

**Goal**: Protect the clean code and enable future development.

**Steps**:
1. Generate ECL document at `docs/ecl/onboard-<scope>.yaml`:
   - Feature guards for each refactored module
   - Each guard lists: key_files, invariants (from test assertions), verification command
2. Update `devcompanion.config.ts` if new module slots were created
3. Write final OL summary:
   - Total modifications applied
   - Risk distribution (low/medium/high)
   - Test coverage achieved
   - Time elapsed
4. Set OL status: `completed`
5. Announce completion:
   ```
   Onboarding complete for <scope>.
   - <N> functions analyzed and documented
   - <M> modifications applied (archived originals in archive/<timestamp>/)
   - <T> tests written (100% function coverage)
   - Report: .devcompanion/reports/onboard-report.html
   - Guards: docs/ecl/onboard-<scope>.yaml
   
   Next: use /ccplan to add new features, /ccdebug if tests break.
   ```

**Output**: ECL with guards, updated config, completion announcement.

---

## State Recovery

If the skill is invoked with `--resume` or if an OL document with non-completed status exists:

1. Read OL document
2. Parse `status` field to determine current phase
3. Resume from that phase's next step
4. Do NOT re-run completed phases (their outputs are already in OL)

If context is compacted mid-session:
1. Read OL from disk
2. Check `status`
3. Continue immediately — never ask "where were we?"

---

## Anti-Patterns

1. **Modifying code without char test** — NEVER. Phase 3 must complete first.
2. **Skipping the log** — NEVER. Every change needs before/after/reason in OL.
3. **Ignoring test failure after change** — NEVER. Fail = immediate revert.
4. **Stopping between phases** — Continue unless waiting for user input.
5. **Forcing utils/features/ structure** — Only if Phase 2 analysis shows it's warranted.
6. **100 modifications at once** — Process one at a time with the protocol.
7. **Deleting code without understanding** — Phase 2 must explain why/what/how first.

---

## Integration with Other Skills

| Situation | Route to |
|-----------|----------|
| High-risk item needs full planning | `/ccplan` |
| Test fails during verify (Phase 7) | `/ccdebug` |
| After onboarding, adding new feature | `/ccplan` |
| Feature guard violated during later work | Feature Guard Protocol (passive) |

---

## OL Document Reference

See [ol-schema.md](./ol-schema.md) for the complete YAML schema of the Onboarding Log.
