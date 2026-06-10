---
description: "Thin wrapper that generates the project's bilingual overview HTML report by invoking the existing scripts/generate-overview.ts. Default mode produces two independent files (English overview-en.html + Chinese overview-zh.html) via the Claude CLI translation step; a fast single-language mode maps to --skip-translation and emits a single overview.html with no LLM call. Always scoped to the current project (no --target)."
---

Read the full skill specification at `skills/ccoverview/SKILL.md`, then execute the /ccoverview workflow.

## Arguments

$ARGUMENTS

No arguments are required — `/ccoverview` always operates on the **current project** and runs `scripts/generate-overview.ts` with **no `--target`**.

If `--skip-translation` is provided, use the **fast single-language mode**: it emits a single `overview.html` and makes no LLM call (no Claude CLI dependency). Otherwise, run the default **bilingual** mode, which produces both `overview-en.html` and `overview-zh.html` and calls the Claude CLI for the Chinese translation.

## Execution

Follow the protocol in `skills/ccoverview/SKILL.md` exactly. This skill is a thin wrapper — it does not generate anything itself, it only selects a mode and shells out to the existing generator:

1. **Default (bilingual)**: `npx tsx scripts/generate-overview.ts` — produces `.devcompanion/reports/overview-en.html` + `.devcompanion/reports/overview-zh.html` (requires the Claude CLI for translation).
2. **Fast (single-language)**: `npx tsx scripts/generate-overview.ts --skip-translation` — produces a single `.devcompanion/reports/overview.html` with no LLM call.

**Boundaries:** always omit `--target` so the run stays scoped to the current project; do NOT reimplement generation logic here — fix any output issues in `scripts/generate-overview.ts`. See `skills/ccoverview/SKILL.md` for the full specification.
