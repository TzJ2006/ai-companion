---
description: >-
  Onboard an existing codebase: scan, analyze, modularize, test, document.
  Transforms messy code into modular, tested, documented code with full audit trail.
  Every modification is logged, tested, and archived.
---

# /cconboard — Codebase Onboarding

## Usage

```
/cconboard                         # onboard current project root
/cconboard packages/core/          # onboard specific directory
/cconboard src/utils.ts            # onboard single file
/cconboard --resume                # resume interrupted onboarding from OL status
```

## What Happens

1. **Scope & Snapshot** — Archive originals, define target scope
2. **AST Scan** — Parse every function, build identity map
3. **Function Analysis** — LLM analyzes why/what/how, classifies pure/adapter/orchestrator, detects side effects
4. **Characterization Tests** — Write tests BEFORE any change (locks current behavior)
5. **Restructure Plan** — Generate risk-tiered modification plan (low=auto, medium=confirm, high=plan-only)
6. **Execute** — Apply changes by tier, log every modification, revert if tests fail
7. **Post-Refactor Tests** — Write complete tests (normal + edge case, 100% coverage target)
8. **Verify & Report** — Run all tests, generate HTML report
9. **Handoff** — Generate feature guards, announce completion

## Core Rules

- **No change without test** — Characterization test must exist before any code modification
- **No change without log** — Every modification logged: what/why/before/after/risk level
- **Fail = revert** — If characterization test fails after a change, immediately revert
- **Archive first** — Original code copied to `archive/<timestamp>/` before anything happens

## Output

- `archive/<timestamp>/` — Original code backup
- `.devcompanion/onboard-logs/<scope>.yaml` — Full audit trail (Onboarding Log)
- `.devcompanion/tests/char_*` — Characterization tests
- `.devcompanion/tests/test_*` — Post-refactor tests
- `docs/ecl/onboard-<scope>.yaml` — Feature guards
- `onboard-report.html` — Visual report

## When to Use

- Joining a new project and need to understand + clean it up
- Taking over unmaintained code
- Preparing a codebase for team collaboration
- Making legacy code testable

## Related Commands

- `/ccplan` — After onboarding, use for new features
- `/ccdebug` — If tests fail during or after onboarding
