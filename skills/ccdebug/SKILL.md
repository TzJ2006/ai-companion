---
name: ccdebug
description: >-
  Test failure debugging skill that traces from failing assertion → source
  function → change history → root cause → fix → record. Phases: (0) triage
  failing tests, (1) locate source functions via test naming + history,
  (2) diagnose root cause with LLM + git diff analysis, (3) fix with max 3
  retry cycles + full regression, (4) record fix in HistoryStore + DL.
  Every fix must log root cause. Fix code, never tests (unless test is wrong).
  Escalate to /ccplan after 3 failed fix attempts.
  TRIGGER when: user says "debug", "fix test", "test failing", "why is this
  broken", or /ccdebug.
  DO NOT TRIGGER when: user wants to onboard code (use /cconboard), wants to
  plan a new feature (use /ccplan), or the failure is a known pre-existing issue.
origin: custom
---

# /ccdebug — Test Failure Debug

## Core Premise

Systematically trace from a failing test back to the responsible code change,
diagnose the root cause, fix it, and record the full trail so future developers
(and future AI sessions) can understand what broke, why, and how it was fixed.

## When to Use

- Test suite fails after implementing a feature (`/ccplan`)
- Characterization test fails after onboarding restructure (`/cconboard`)
- User reports a bug that can be reproduced by a test
- Runtime error needs to be turned into a regression test + fix

## Conversation Loop Protocol

1. On invocation: check for existing DL with non-completed status (resume if found)
2. If resuming: pick up from last recorded phase
3. If new: start Phase 0
4. Advance through phases continuously
5. Only pause for: user input needed (ambiguous root cause) or max retries hit
6. After each phase: update DL document status on disk

---

## Phase 0: TRIAGE

**Goal**: Identify what's failing and collect structured failure data.

**Steps**:
1. Determine test scope from invocation:
   - No argument → run full test suite
   - Test name → run that specific test file
   - `--file <path>` → find tests related to that source file
2. Run tests with JSON reporter:
   ```bash
   npx vitest run <scope> --reporter=json
   ```
3. Parse JSON output, extract for each failure:
   - `test_file`: which test file
   - `assertion`: the failing assertion name (fullName)
   - `error_message`: first line of failure message
   - `expected`: expected value (if available)
   - `actual`: actual value (if available)
   - `stack_trace`: first 5 lines of stack
4. If zero failures: announce "All tests passing" and exit
5. Initialize Debug Log (DL) at `.devcompanion/debug-logs/<ISO-timestamp>.yaml`
6. Write failures section to DL
7. Set DL status: `phase-0-complete`

**Output**: DL initialized with structured failure list.

**Tools**: Bash (vitest), Write (DL yaml)

---

## Phase 1: LOCATE

**Goal**: Trace each failure back to the responsible source function and its change history.

**Steps**:
1. For each failure, resolve the source function:
   - Parse test file name: `test_<module>_<functionName>.test.ts` → target function
   - If test imports are explicit: follow import to source file
   - If ambiguous: grep for the function name in source files
2. For each located function:
   - Read `.devcompanion/analysis.json` → get function's why/what/how analysis
   - Compute function identity hash via `computeFunctionIdentity`
   - Query HistoryStore: `getFunctionHistory(hash)` → get ChangeRecords with reasons
   - Run `git log --oneline -10 -- <source_file>` → recent commits touching this file
   - Run `git log -p -3 -- <source_file>` → last 3 diffs for context
3. If HistoryStore has records with `reason` field → these are the most valuable
4. Write localization section to DL:
   - `source_file`, `source_function`, `function_hash`
   - `recent_changes`: list of {sha, date, reason, diff_summary}
5. Set DL status: `phase-1-complete`

**Output**: Each failure linked to source function + change history.

**Reuse**: `packages/ast/` (computeFunctionIdentity, parseFileAuto), `packages/history/` (HistoryStore)

---

## Phase 2: DIAGNOSE

**Goal**: Determine WHY each function is broken — the root cause.

**Steps**:
1. For each failure (prioritize by simplest first):
   - Read the failing test's assertion code
   - Read the source function's current implementation
   - If recent changes exist: read the diffs
2. Analyze root cause — consider categories:
   - `contract-violation`: function returns different shape than caller expects
   - `null-check`: missing null/undefined guard
   - `type-mismatch`: wrong type passed or returned
   - `logic-error`: algorithm bug (wrong condition, off-by-one, etc.)
   - `race-condition`: async timing issue
   - `env-dependency`: depends on environment state (paths, env vars, OS)
   - `import-error`: module not found, circular dependency
   - `mock-drift`: test mock doesn't match real implementation
3. For each diagnosis, record:
   - `root_cause`: one-sentence explanation
   - `introduced_by`: git SHA (if identifiable) or "pre-existing"
   - `confidence`: high (obvious from diff) | medium (likely) | low (hypothesis)
   - `category`: from list above
4. If confidence is `low` and multiple hypotheses exist:
   - Present top 2 hypotheses to user via AskUserQuestion
   - Let user pick or provide context
5. Write diagnosis section to DL
6. Set DL status: `phase-2-complete`

**Output**: Root cause hypothesis for each failure.

**Key Principle**: The diagnosis must explain WHY the code is wrong, not just WHERE.

---

## Phase 3: FIX

**Goal**: Apply minimal, targeted fixes and verify they work.

**CRITICAL PROTOCOL — For EVERY fix**:

```
ATTEMPT (max 3 per failure):
  1. Generate fix based on diagnosis
     - Prefer minimal change (fewest lines modified)
     - Prefer fixing root cause over patching symptoms
     - NEVER modify the test unless test is provably wrong
  2. Apply the fix
  3. Run the failing test:
     npx vitest run <test_file>
  4. If PASS:
     - Run full regression: npx vitest run
     - If regression PASS → record fix, move to next failure
     - If regression FAIL → revert fix, new failure = new DBG item, re-diagnose
  5. If FAIL:
     - Revert fix
     - Increment attempt counter
     - Re-enter Phase 2 with new information (what didn't work)
     - If attempt >= 3 → STOP, escalate to /ccplan

ESCALATION:
  After 3 failed attempts:
  1. Record in DL: status = "escalated"
  2. Write recommendation: "This failure requires /ccplan — root cause is <X>,
     attempted fixes <Y, Z, W> all failed because <reason>"
  3. Do NOT continue fixing other failures that depend on this one
```

**Fix Priority Order**:
1. Failures with `confidence: high` diagnosis first
2. Leaf functions (no other failures depend on them) before orchestrators
3. `contract-violation` and `null-check` before `logic-error` and `race-condition`

**Output**: Fixed code, all tests passing (or escalation recorded).

---

## Phase 4: RECORD

**Goal**: Create a complete audit trail of what was fixed and why.

**Steps**:
1. For each fixed failure:
   - Write fix entry to DL:
     - `fix_description`: what was changed
     - `file`, `function`, `lines_changed`
     - `test_status`: pass
     - `regression_status`: pass
     - `applied_at`: timestamp
   - Write ChangeRecord via HistoryStore:
     ```
     store.saveSession({
       changes: [{ file_path, function_name, change_type: "fix", reason: root_cause }],
       trigger: "ccdebug"
     })
     ```
   - Update function index hash (if signature changed)
   - Add `debug_refs` entry to function's history record pointing to this DL timestamp

2. Check ECL feature guards:
   - If any modified file is guarded: run the guard's verification command
   - If guard fails: REVERT and escalate (guard violation = architectural issue)

3. Final summary:
   ```
   Debug session complete.
   - Failures found: <N>
   - Fixed: <M>
   - Escalated: <E> (require /ccplan)
   - DL: .devcompanion/debug-logs/<timestamp>.yaml
   
   Root causes:
   - DBG-001: <one-line root cause>
   - DBG-002: <one-line root cause>
   ```

4. Set DL status: `completed`

**Output**: DL completed, ChangeRecords written, function history cross-referenced.

---

## State Recovery

If the skill is invoked with `--resume` or if a DL document with non-completed status exists:

1. Read most recent DL document from `.devcompanion/debug-logs/`
2. Parse `status` field to determine current phase
3. Resume from that phase's next step
4. Do NOT re-run completed phases

If context is compacted mid-session:
1. Read DL from disk
2. Check `status`
3. Continue immediately — never ask "where were we?"

---

## Anti-Patterns

1. **Modifying tests to make them pass** — NEVER (unless test is provably wrong: wrong expected value, testing removed behavior, or mock doesn't match real API)
2. **Fixing symptoms not causes** — Adding null checks without understanding WHY null appeared
3. **Skipping regression** — A fix that breaks other tests is not a fix
4. **More than 3 attempts without escalating** — Diminishing returns, likely needs redesign
5. **Not recording root cause** — Future debuggers need to know WHY, not just WHAT
6. **Fixing multiple failures in one edit** — One fix per failure, verify independently
7. **Reverting to old code blindly** — Understand what the change was trying to achieve first

---

## Integration with Other Skills

| Situation | Route to |
|-----------|----------|
| 3 fix attempts exhausted | `/ccplan` — needs redesign |
| Fix reveals architectural flaw | `/ccplan` — plan the restructure |
| Fix reveals untested code paths | Add tests, then continue |
| Code needs onboarding first (no tests, no analysis) | `/cconboard` |
| Feature guard violated by fix | Revert, then `/ccplan` |

---

## DL Document Reference

See [dl-schema.md](./dl-schema.md) for the complete YAML schema of the Debug Log.
