---
name: ccoverview
description: >-
  Thin wrapper that generates the project's bilingual overview HTML report by
  invoking the existing scripts/generate-overview.ts. Default mode produces two
  independent files (English overview-en.html + Chinese overview-zh.html) and
  calls the Claude CLI for translation. A fast English single-language mode maps to the
  existing --skip-translation flag and emits a single English overview.html with no LLM
  call. Optional --target selects a project; when omitted, defaults to the current
  project (cwd / git root), not the companion checkout.
  TRIGGER when: user says "ccoverview", "generate the overview", "regenerate the
  overview report", "build overview.html", or invokes /ccoverview.
  DO NOT TRIGGER when: user wants to plan (use /ccplan), execute (use /ccedit),
  debug (use /ccdebug), or onboard a new codebase (use /cconboard).
origin: custom
---

# /ccoverview — Bilingual Overview Generator (thin wrapper)

## Core Premise

> **This skill generates nothing on its own. It is a THIN WRAPPER over the
> existing generator at `scripts/generate-overview.ts`.**
> Do NOT reimplement any generation logic, HTML rendering, or translation here.
> The only job of /ccoverview is to choose the right mode and run the existing
> script via `npx tsx scripts/generate-overview.ts`.

The generation pipeline (AST scan, ECL reading, HTML rendering, and the
English↔Chinese translation step) already lives in `scripts/generate-overview.ts`
and its helpers. This skill is a documented entry point, not a second
implementation.

## When to Use

- After onboarding or planning changes, when you want a fresh human-readable
  overview of the current project.
- When you want both an English and a Chinese version of the overview report.
- When you only need a quick single-language report and want to skip the
  (slower, LLM-backed) translation step.

**Do NOT use** for planning (use /ccplan), execution (use /ccedit), debugging
(use /ccdebug), or onboarding an existing codebase (use /cconboard).

## Scope

`/ccoverview` overviews **the current project** by default. `--target` is
**allowed**. When it is omitted, `scripts/generate-overview.ts` resolves the
project from the process cwd (git root if the cwd is inside a repo). That is
the repo the user is in — not the AI Dev Companion checkout — even when an
installed command stub invokes the companion script by absolute path.

Pass `--target <path>` only when you need to overview a tree other than cwd.
Forward any `--target` / `--skip-translation` values from `$ARGUMENTS`.

## Prerequisites

- **Default (bilingual) mode requires the Claude CLI to be available**, because
  the translation step calls Claude to produce the Chinese version. If the
  Claude CLI is unavailable, use the fast `--skip-translation` mode instead
  (see below) — it produces a single English report with no LLM call.

## Execution

### Default mode — bilingual (English + Chinese)

Run the existing script (add `--target <path>` only when not overviewing cwd):

```bash
npx tsx scripts/generate-overview.ts
```

This invokes `scripts/generate-overview.ts`, which produces **two independent
files**:

- `.devcompanion/reports/overview-en.html` — the English overview
- `.devcompanion/reports/overview-zh.html` — the Chinese overview

The Chinese file is produced by the script's translation step, which calls the
Claude CLI. This mode therefore requires the Claude CLI to be available.

### Fast mode — single language, no translation

When you want speed, or when the Claude CLI is unavailable, map to the existing
`--skip-translation` flag:

```bash
npx tsx scripts/generate-overview.ts --skip-translation
```

The `--skip-translation` flag is the **fast single-language (English) mode**: it produces a
single English `.devcompanion/reports/overview.html` and makes **no LLM call** (no
Claude CLI dependency, no translation step).

## Output

| Mode | Command | Files produced | LLM call |
|------|---------|----------------|----------|
| Default (bilingual) | `npx tsx scripts/generate-overview.ts` | `.devcompanion/reports/overview-en.html` + `.devcompanion/reports/overview-zh.html` | Yes (Claude CLI, for the Chinese translation) |
| Fast (single-language, English) | `npx tsx scripts/generate-overview.ts --skip-translation` | `.devcompanion/reports/overview.html` | No |

All output paths are relative to the **target project's** `.devcompanion/reports/`
directory (cwd / git root, or `--target`).

## Notes

- **Do NOT reimplement generation.** If the overview output looks wrong, fix it
  in `scripts/generate-overview.ts` (or its helpers), not here. This skill only
  selects a mode and shells out.
- The two bilingual files (`overview-en.html` and `overview-zh.html`) are
  **independent files**, not two views of one document. The fast mode's
  `overview.html` is a separate, third output name.
- Default (bilingual) mode depends on the Claude CLI for translation; prefer the
  `--skip-translation` fast mode when the CLI is unavailable or when you only
  need a quick English report.
- **`--target` is allowed.** Omit it to stay on the current project. Installed
  stubs may rewrite `scripts/` to the companion absolute path; still omit
  `--target` unless overviewing a different tree — the generator defaults to cwd.
