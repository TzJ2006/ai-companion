---
description: >-
  Debug Log (DL) YAML schema reference for /ccdebug.
  Defines the structure of .devcompanion/debug-logs/<timestamp>.yaml
---

# Debug Log Schema

The DL document tracks an entire debug session. Written to `.devcompanion/debug-logs/<ISO-timestamp>.yaml`.

One DL per `/ccdebug` invocation. Functions' history records cross-reference the DL via `debug_refs`.

## Full Schema

```yaml
dl_version: "1.0"
trigger: "test-failure"           # test-failure | runtime-error | user-report
status: "phase-2-diagnosing"      # see Status Values below
created: "2026-05-16T10:00:00Z"
updated: "2026-05-16T10:15:00Z"
git_sha: "abc123def"
test_scope: ".devcompanion/tests/" # what was run (path, glob, or "all")

# Phase 0 output
failures:
  - id: DBG-001
    test_file: "test_parser_parseFile.test.ts"
    assertion: "should parse empty file without error"
    error_message: "TypeError: Cannot read property 'length' of undefined"
    expected: "{ functions: [], classes: [] }"
    actual: "TypeError thrown"
    stack_trace: |
      at parseFile (packages/ast/src/parser.ts:45:12)
      at Object.<anonymous> (.devcompanion/tests/test_parser_parseFile.test.ts:18:20)
    status: fixed              # investigating | diagnosed | fixed | escalated | wont-fix

# Phase 1 output
localization:
  - failure_id: DBG-001
    source_file: "packages/ast/src/parser.ts"
    source_function: "parseFile"
    function_hash: "a1b2c3d4e5f6"
    analysis:
      why: "Transforms raw source text into structured AST"
      what: "Parses a source file and returns a ParsedModule"
      category: "pure"
    recent_changes:
      - sha: "def456abc"
        date: "2026-05-15"
        author: "dev"
        reason: "Added multi-language support"
        diff_summary: "Changed return type, added language dispatch"
      - sha: "789ghi012"
        date: "2026-05-14"
        author: "dev"
        reason: "Initial implementation"
        diff_summary: "New file"

# Phase 2 output
diagnosis:
  - failure_id: DBG-001
    root_cause: "parseFile returns null when input is empty string, but caller expects ParsedModule object"
    introduced_by: "def456abc"        # git SHA or "pre-existing"
    confidence: high                  # high | medium | low
    category: contract-violation      # see Category Values below
    attempted_hypotheses: []          # filled if confidence was initially low

# Phase 3 output
fixes:
  - failure_id: DBG-001
    attempt: 1                        # which attempt (1-3)
    fix_description: "Add empty-input guard at line 45 returning empty ParsedModule"
    file: "packages/ast/src/parser.ts"
    function: "parseFile"
    lines_changed: [45, 46]
    diff: |
      + if (!source || source.trim() === "") {
      +   return { file_path: filePath, functions: [], classes: [], imports: [] };
      + }
    test_status: pass                 # pass | fail
    regression_status: pass           # pass | fail | not-run
    applied_at: "2026-05-16T10:15:00Z"

# Phase 3 — escalated failures (3 attempts exhausted)
escalations:
  - failure_id: DBG-003
    attempts: 3
    reason: "Root cause is architectural — function assumes sync but caller is async"
    recommendation: "Use /ccplan to redesign the async boundary"
    last_attempt_diff: "..."

# Phase 4 output
record:
  change_records_written: 1
  function_history_updated:
    - hash: "a1b2c3d4e5f6"
      debug_ref: "2026-05-16T10-00-00"
  ecl_guards_checked: true
  ecl_violations: []

# Summary (written at completion)
summary:
  total_failures: 3
  fixed: 2
  escalated: 1
  wont_fix: 0
  total_fix_attempts: 4              # sum of all attempts across all failures
  session_duration_minutes: 15
```

## Failure Status Values

| Status | Meaning |
|--------|---------|
| `investigating` | Phase 1 in progress — locating source |
| `diagnosed` | Phase 2 complete — root cause identified |
| `fixed` | Phase 3 complete — fix applied and verified |
| `escalated` | 3 attempts failed — needs `/ccplan` |
| `wont-fix` | Intentional behavior or pre-existing known issue |

## Diagnosis Category Values

| Category | Description | Common Fix Pattern |
|----------|-------------|--------------------|
| `contract-violation` | Function returns different shape/type than caller expects | Add type guard or fix return value |
| `null-check` | Missing null/undefined handling | Add guard clause |
| `type-mismatch` | Wrong type passed to or returned from function | Fix type at source |
| `logic-error` | Wrong condition, off-by-one, incorrect algorithm | Fix the logic |
| `race-condition` | Async timing, unhandled promise, shared state | Add await/lock/sequencing |
| `env-dependency` | Depends on OS, paths, env vars, or runtime state | Inject dependency or normalize |
| `import-error` | Module not found, circular dep, wrong path | Fix import path |
| `mock-drift` | Test mock doesn't match current real implementation | Update mock (this is a valid test fix) |

## DL Status Values

Format: `phase-<N>-<substatus>`

Examples:
- `phase-0-running-tests`
- `phase-0-complete`
- `phase-1-locating`
- `phase-1-complete`
- `phase-2-diagnosing`
- `phase-2-waiting-user` (ambiguous root cause, asked user)
- `phase-2-complete`
- `phase-3-fixing`
- `phase-3-retry-2` (second attempt)
- `phase-3-complete`
- `phase-4-recording`
- `completed`

## Cross-Reference in Function History

When a fix is recorded, the function's entry in HistoryStore gains:

```json
{
  "hash": "a1b2c3d4e5f6",
  "debug_refs": ["2026-05-16T10-00-00"],
  "last_debug": {
    "date": "2026-05-16T10:15:00Z",
    "category": "contract-violation",
    "root_cause": "returns null on empty input"
  }
}
```

This allows future sessions to see: "this function was debugged before for X reason" — preventing repeat investigations.
