---
description: "Debug failing tests: trace from failure → source function → change history → root cause → fix → record. Enforces fix-code-not-tests, max 3 retries, full regression."
---

Read the full skill specification at `skills/ccdebug/SKILL.md` and the DL schema at `skills/ccdebug/dl-schema.md`, then execute the /ccdebug workflow.

## Arguments

$ARGUMENTS

If no arguments provided, run all tests and debug all failures.
If a test name is provided, debug that specific test file.
If `--file <path>` is provided, debug failures related to that source file.
If `--resume` is provided, resume from the last recorded DL status.

## Execution

Follow the 5-phase protocol defined in `skills/ccdebug/SKILL.md` exactly:

1. Read the SKILL.md file for the complete technical specification
2. Check if a DL document with non-completed status exists (resume if so)
3. Execute phases 0-4 in order, advancing continuously
4. Only pause for: ambiguous root cause needing user input, or max retries hit
5. Write DL status to disk after each phase completion
