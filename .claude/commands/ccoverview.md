---
description: "Thin wrapper that generates the project's bilingual overview HTML report by invoking the existing scripts/generate-overview.ts. Default mode produces two independent files (English overview-en.html + Chinese overview-zh.html) via the Claude CLI translation step; a fast English single-language mode maps to --skip-translation and emits a single overview.html with no LLM call. Optional --target selects a project; when omitted, defaults to the current project (cwd / git root)."
---

Read the full skill specification at `skills/ccoverview/SKILL.md`, then execute the /ccoverview workflow.

## Arguments

$ARGUMENTS

Arguments are optional. `--target` is **allowed** — pass it through to the
generator when the user supplies a path. When `--target` is omitted, the
generator overviews the **current project** (process cwd / git root of the repo
the user is in), not the companion checkout. Installed command stubs may point
at the companion `generate-overview.ts` by absolute path; they still inherit
the host repo cwd, so omitting `--target` is correct for the current project.

If `--skip-translation` is provided, use the **fast English single-language mode**: it emits a single English `overview.html` and makes no LLM call (no Claude CLI dependency). Otherwise, run the default **bilingual** mode, which produces both `overview-en.html` and `overview-zh.html` and calls the Claude CLI for the Chinese translation.

## Execution

Follow the protocol in `skills/ccoverview/SKILL.md` exactly. This skill is a thin wrapper — it does not generate anything itself, it only selects a mode and shells out to the existing generator:

1. **Default (bilingual)**: `npx tsx scripts/generate-overview.ts` — produces `.devcompanion/reports/overview-en.html` + `.devcompanion/reports/overview-zh.html` (requires the Claude CLI for translation).
2. **Fast (single-language, English)**: `npx tsx scripts/generate-overview.ts --skip-translation` — produces a single English `.devcompanion/reports/overview.html` with no LLM call.

Forward `$ARGUMENTS` (`--target`, `--skip-translation`) to the script. Do NOT reimplement generation logic here — fix any output issues in `scripts/generate-overview.ts`. See `skills/ccoverview/SKILL.md` for the full specification.
