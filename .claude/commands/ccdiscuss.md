---
description: "Best-effort conversational alignment loop that runs BEFORE /ccplan. Aligns the human and the AI on a single idea via 6 steps (conflict/dup-check, human-writes-expected-FIRST, AI's 5 questions + divergence flags, resolve, value/soft verification, split into ECL nodes). Writes an aligned ECL that /ccplan reads IF PRESENT — no gate, no enforcement."
---

Read the full skill specification at `skills/ccdiscuss/SKILL.md`, then execute the /ccdiscuss workflow.

## Arguments

$ARGUMENTS

If a quoted string / description is provided, treat it as the fresh idea to align on.
If no arguments are provided, ask the user for the idea to align on before starting.
If `--resume` is provided, resume from the most recent non-completed alignment ECL in `docs/ecl/`.

## Execution

Follow the 6-step best-effort loop in `skills/ccdiscuss/SKILL.md` exactly:

1. **Conflict / duplication check** — reuse ccplan Phase 1 "ECL Reuse Discovery" against `docs/ecl/`; classify each touch point (reuse-direct / reuse-extend / reuse-adapt / new).
2. **Human writes the expected result FIRST** — capture it verbatim as `expected_result_human` BEFORE revealing the AI's inference (this ordering is the heart of the loop).
3. **AI emits the 5 questions + flags divergence** — 是什么 / 为什么做 / 如何做 / 为什么这样做 / 期望结果, each marked `aligned` / `divergent` / `unknown` against Step 2.
4. **Resolve divergence on the spot** — reconcile every `divergent`/`unknown` item in conversation (prefer multiple-choice); end with everything `aligned` or an explicitly-accepted residual gap.
5. **Define verification** — value(s) + comparison code (number/boolean + pass/fail expression); if it cannot be reduced to a value, set `kind: soft` + require human sign-off.
6. **Split into ECL node(s)** — each carrying its own 5 questions, expected result, resolved divergences, and verification; persist to `docs/ecl/<feature>.yaml`.

**Boundaries:** /ccdiscuss is READ-ONLY (the only files it writes are `docs/ecl/*.yaml`) and **best-effort** — not always-on, not enforced, not a gate. It hands off to `/ccplan`, which reads the aligned ECL **if present** (never a hard prerequisite). Deeper planning is `/ccplan`; implementation is `/ccedit`.
