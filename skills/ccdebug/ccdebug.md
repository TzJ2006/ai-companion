---
description: >-
  Debug failing tests by tracing from failure → source function → change history
  → root cause → fix → record. Enforces: fix code not tests, max 3 retry cycles,
  full regression check, mandatory root cause logging.
---

# /ccdebug — Test Failure Debug

## Usage

```
/ccdebug                           # run all tests, debug all failures
/ccdebug test_parser_parseFile     # debug specific test file
/ccdebug --file src/parser.ts      # debug failures related to a source file
/ccdebug --resume                  # resume interrupted debug session from DL
```

## What Happens

0. **Triage** — Run tests, collect failures (test_file, assertion, error, expected vs actual)
1. **Locate** — Trace each failure back to source function + recent change history
2. **Diagnose** — Analyze root cause (which change broke it, why)
3. **Fix** — Apply fix, verify test passes, run regression (max 3 attempts)
4. **Record** — Write ChangeRecord, update DL, cross-reference in function history

## Core Rules

- **Fix code, not tests** — Unless the test itself is provably wrong
- **Max 3 fix attempts** — If still failing after 3 cycles, escalate to `/ccplan`
- **Full regression** — Every fix must pass ALL tests, not just the target
- **Root cause required** — Every fix must record WHY the bug existed

## Output

- `.devcompanion/debug-logs/<timestamp>.yaml` — Debug Log (full audit trail)
- ChangeRecord in HistoryStore — links fix to function + reason
- Function history cross-ref — `debug_refs` pointing to the DL

## When to Use

- Test suite has failures after a `/ccplan` implementation
- After `/cconboard` surfaces known failures worth fixing
- Runtime error traced to a specific function
- User reports a bug with reproduction steps

## Related Commands

- `/ccplan` — If 3 fix attempts fail, escalate to full planning
- `/cconboard` — If the failing code needs broader restructuring first
