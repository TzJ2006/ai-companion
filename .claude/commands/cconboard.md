---
description: "Onboard an existing codebase: scan, analyze, modularize, test, document. Transforms messy code into modular, tested, documented code with full audit trail."
---

Read the full skill specification at `skills/cconboard/SKILL.md` and the OL schema at `skills/cconboard/ol-schema.md`, then execute the /cconboard workflow.

## Arguments

$ARGUMENTS

If no arguments provided, onboard the current project root.
If a path is provided, onboard that specific directory or file.
If `--resume` is provided, resume from the last recorded OL status.

## Execution

Follow the 8-phase protocol defined in `skills/cconboard/SKILL.md` exactly:

1. Read the SKILL.md file for the complete technical specification
2. Check if an OL document already exists for this scope (resume if so)
3. Execute phases 0-8 in order, advancing continuously
4. Only pause for: medium-risk confirmations or explicit user pause
5. Write OL status to disk after each phase completion
