---
description: "Evolving Constraint Planning: diverge-then-converge requirement engineering with adversarial validation. Use when requirements are ambiguous, conflicting, or multi-session."
---

Read the full skill specification at `skills/ccplan/SKILL.md` and the ECL schema at `skills/ccplan/ecl-schema.md`, then execute the /ccplan workflow.

## Arguments

$ARGUMENTS

If no arguments provided, start a new planning session (will prompt for intent).
If a quoted string is provided, use it as the initial requirement/intent.
If `--resume` is provided, resume from the most recent ECL document in `docs/ecl/`.
If `--guard` is provided, show active feature guards (optionally scoped to a path).
If `--guard --verify` is provided, run all guard verification commands.

## Execution

Follow the 12-phase protocol defined in `skills/ccplan/SKILL.md` exactly:

1. Read the SKILL.md file for the complete technical specification
2. Check if an ECL document exists for this scope (resume if so)
3. Execute phases 0-11 in order, advancing continuously
4. **STOP at Phase 9 (Review Gate)** — present the complete plan and WAIT for user approval
5. Only proceed to Phase 10 (Implementation) after explicit user confirmation
6. Write ECL status to disk after each phase completion
