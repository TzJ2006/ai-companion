---
name: code-summarizer
description: >
  Generate paper-style overview documents for code projects. Produces a structured
  report with Highlights, Introduction, Architecture, Implementation, Results, and
  Conclusion & Future Work — readable by anyone from the original author to external
  audiences. Use when users want to understand, summarize, explain, or document a
  codebase. Trigger on: "what does this code do", "summarize this", "explain this
  module", "walk me through this", "generate overview", uploading code with general
  questions, or the /code-summarize command.
  Do NOT trigger when the user asks to optimize, refactor, fix, or extend code.
origin: custom
---

# Code Summarizer — Paper-Style Project Overview

Generate structured, paper-style overview documents for code projects. The output
reads like a technical report: concise highlights up front, clear motivation,
architectural walkthrough, implementation details, real results, and forward-looking
conclusions.

## Slash Command

```
/code-summarize                    # Current directory (./)
/code-summarize src/               # Specific directory
/code-summarize --deploy           # Generate + deploy to Hugo (gadget only)
/code-summarize --for self         # Author review perspective
/code-summarize --for coworker     # Team collaboration perspective
/code-summarize --for user         # End-user / API consumer perspective
/code-summarize --for display      # Showcase / presentation perspective
/code-summarize src/ --for coworker --deploy  # Combined flags
```

See `code-summarize.md` for full command specification.

## Document Structure — Six Sections

Every output follows this structure. Adapt depth per section to the project's
scale and complexity — never pad a simple project into an artificially long document.

### 1. Highlights

**3-5 bullet points** summarizing the most important things a reader should know.
Think of these as the "TL;DR" — if someone reads nothing else, these bullets
should convey the project's essence.

Each bullet should be one sentence, answering one of:
- What is the core capability?
- What problem does it solve?
- What is the key technical approach?
- What makes it interesting or different?

**Example:**
> - CLI tool that converts PDF academic books to structured weekly reading notes via OCR
> - Two-stage pipeline: raw OCR extraction → AI-powered 9-section note structuring
> - Tracks cross-week concept evolution with 承前 (carry-forward) connections
> - Optimized for Chinese Medical History texts with specialized term handling

### 2. Introduction

**2-4 paragraphs** covering: what this code is, what problem it solves, why it
exists, and who it's for. This section merges the traditional "Introduction" and
"Motivation" into a single narrative.

Structure:
1. **What it is** — One sentence defining the project (tool? library? service? pipeline?)
2. **The problem** — What pain point or need motivated its creation? Be specific.
3. **The approach** — How does it solve the problem at a high level? (Details go in Architecture/Implementation)
4. **Context** — Where does this fit in the broader ecosystem? Is it standalone, part of a larger system, a replacement for something else?

**Data sources:** README, CLAUDE.md, package manifests (pyproject.toml, package.json, etc.), top-level docstrings, git history (first commit message often reveals original intent).

**Tone:** Write for someone who is technically literate but unfamiliar with this specific project. Avoid jargon that isn't defined in the codebase itself.

### 3. Architecture

**The "how it's organized" section.** Show the reader the mental model they need
to navigate the codebase.

Cover:
- **Directory/module structure** — Tree view with brief annotations per directory
- **Data flow** — How does information move through the system? (Input → Processing → Output)
- **Key abstractions** — Important classes, interfaces, or patterns (Repository pattern, Event bus, Pipeline stages, etc.)
- **Dependency map** — External packages and their roles; internal module import relationships
- **Configuration** — Environment variables, config files, and how they affect behavior

Use ASCII diagrams for data flow when it helps:

```
Input (PDF) → OCR Engine → Raw Markdown → LLM Structurer → 9-Section Notes
                                              ↓
                                        Reading Log Update
```

**Data sources:** Directory structure, import statements, config files, type definitions, entry points.

### 4. Implementation

**The "how it actually works" section.** Dive into the key algorithms, core
functions, and non-obvious technical decisions.

For each significant component:
- **What it does** — One sentence purpose
- **How it works** — The algorithm or approach, at the level of detail a new contributor needs
- **Why this way** — If the implementation choice isn't obvious, explain the reasoning (performance? compatibility? simplicity?)
- **Notable details** — Edge case handling, clever tricks, or gotchas worth knowing

**What to include:** Focus on functions a newcomer *must* understand to contribute.
Skip trivial helpers, boilerplate, and obvious wrappers.

**What NOT to include:** Don't list every function. Don't reproduce code. Extract
the logic and explain it in prose, referencing specific function names and file
paths so the reader can find the code.

Group related functions by feature/flow rather than by file order.

### 5. Results

**Evidence that the code works.** This section grounds the document in reality
rather than just describing intent.

**Three-tier data sourcing strategy** (use the highest available tier):

**Tier 1 — Actual outputs** (preferred):
Read files in `outputs/`, `results/`, `dist/`, `build/`, `logs/`, or similar
directories. Quote or summarize real output. Include performance numbers,
generated file counts, processing times — anything concrete.

**Tier 2 — Documented examples**:
Read README, docs/, examples/, or test fixtures for usage examples and expected
output. Reference screenshots or demo files if they exist.

**Tier 3 — Code-inferred behavior** (fallback):
When no outputs or docs exist, describe what the code *would* produce based on
its logic. **Always mark these with `[Inferred from code]`** so the reader knows
this wasn't verified against actual execution.

**What to cover:**
- Usage examples (CLI invocations, API calls, function usage)
- Sample output (actual or documented)
- Performance characteristics (if measurable or documented)
- Test coverage or CI status (if present)
- Known limitations or failure modes

**Never fabricate results.** If you can't find evidence of results, say so:
"No output artifacts or test results were found in the repository."

### 6. Conclusion & Future Work

**Wrap-up and forward look.** Two distinct parts:

**Conclusion** (1-2 paragraphs):
- Restate the core contribution in one sentence
- Assess the project's current state: complete? alpha? actively developed? abandoned?
- Note the strongest aspects (clean architecture, good test coverage, etc.)
- Note the weakest aspects (missing error handling, no tests, hardcoded values, etc.)

**Future Work** (bullet list):
Ground this in **concrete evidence from the code**, not speculation:
- `TODO` and `FIXME` comments (quote them with file:line references)
- Open issues (if accessible via GitHub)
- Commented-out code or feature flags suggesting planned features
- Gaps identified in the Architecture or Implementation sections
- Missing test coverage for critical paths

**Mark speculative items explicitly:** If you suggest a direction not grounded
in code evidence, prefix with `[Suggested]`. Keep these to 1-2 items maximum.

## Audience Adaptation

The `--for <audience>` flag tailors the overview to a specific reader. When
omitted, the default behavior targets a **general** technical reader (current
behavior, fully backward-compatible).

### Audience Types

| Audience | One-liner | Tone & Terminology |
|----------|-----------|-------------------|
| `self` | The original author revisiting their own code | Internal code names, no definitions needed. Like notes to your future self. |
| `coworker` | A colleague who needs to work with this code | Define terms on first use. Like an onboarding doc for a new team member. |
| `user` | An end-user or API consumer who wants to *use* the code | User-facing language, avoid internal implementation terms. Like a README Getting Started. |
| `display` | External audience: blog post, portfolio, demo, management | Broad audience, technical terms with brief explanations. Like a tech blog or project pitch. |

### Section Weight Matrix

Depth per section by audience (◆ = deep/expanded, ● = standard, ○ = brief/compressed, — = may omit):

| Section | self | coworker | user | display |
|---------|------|----------|------|---------|
| Highlights | ○ 2-3 bullets | ● 3-5 bullets | ◆ 3-5 功能导向 | ◆ 3-5 impact-first |
| Introduction | ○ 1 paragraph | ● 2-3 paragraphs | ◆ 2-4 产品说明式 | ◆ 2-3 pitch 式 |
| Architecture | ● standard | ◆ navigation guide | ○ high-level only | ● diagram-first |
| Implementation | ◆ decisions + gotchas | ◆ interfaces + extension points | — or 1 paragraph | ○ 1-2 亮点 only |
| Results | ● performance data | ◆ how to test/verify | ◆ Usage Guide style | ◆ quantified metrics |
| Future Work | ◆ full TODO list | ● standard | ○ Known Limitations | ● vision-oriented |

### Per-Audience Section Guidelines

#### `self` — Author Review

- **Highlights:** Only non-obvious points. Skip anything you'd remember from the project name alone.
- **Introduction:** One paragraph max. You know why this exists.
- **Architecture:** Standard depth. Focus on module relationships you might forget after months away.
- **Implementation:** This is your core section. For each key function, emphasize:
  - *Why this approach* over alternatives (the decision, not the description)
  - Non-obvious edge cases and gotchas
  - Workarounds or hacks with their rationale
  - Performance-critical paths and their constraints
- **Results:** Actual performance data, benchmark numbers. What was the last known state?
- **Future Work:** Exhaustive. List every `TODO`, `FIXME`, `HACK`, `XXX` with file:line references. This is your "where to pick up next" checklist.

#### `coworker` — Collaboration Onboarding

- **Highlights:** Standard. Give the 30-second elevator pitch of the project.
- **Introduction:** Standard. Cover what, why, and where this fits in the broader system.
- **Architecture:** This is your core section. Provide:
  - Directory/module map with "start here" annotations
  - File-level navigation: which files change often vs. which are stable
  - Conventions and patterns used (naming, error handling, config resolution)
  - Dependency boundaries: what you can change safely vs. what has ripple effects
- **Implementation:** Focus on public interfaces and contracts:
  - Function signatures, expected input/output types
  - Extension points: where and how to add new functionality
  - Anti-patterns: things that look wrong but are intentional (and why)
- **Results:** Focus on verification: how to run tests, what a successful build looks like, how to validate changes locally.
- **Future Work:** Standard. Note areas that are actively being worked on to avoid conflicts.

#### `user` — End-User / API Consumer

- **Highlights:** Feature-oriented. Each bullet answers "what can I do with this?" not "how is it built?"
- **Introduction:** Write like a product description:
  - What problem does it solve *for the user*?
  - Who is it for? (prerequisites, skill level)
  - How does it compare to alternatives? (if relevant)
- **Architecture:** Compress to 1-2 paragraphs. Only include what helps the user form a mental model of how to interact with the system (e.g., "it's a CLI tool with three subcommands" or "it's a REST API with these endpoints"). No internal module details.
- **Implementation:** Omit entirely for small projects. For larger ones, include at most 1 paragraph explaining the core mechanism in plain language (e.g., "uses OCR to extract text, then an LLM to structure it").
- **Results:** This becomes your **Usage Guide**:
  - Installation/setup steps
  - CLI examples with expected output
  - API call examples with request/response
  - Input format requirements and output format descriptions
  - Common error messages and how to resolve them
- **Future Work:** Rename to "Known Limitations." Only list things that affect the user's experience. Skip internal tech debt.

#### `display` — Showcase / Presentation

- **Highlights:** Impact-first writing. Lead with outcomes and numbers:
  - ✗ "Uses SHA-256 content hashing for cache invalidation"
  - ✓ "Reduces repeated processing by 90% through intelligent caching"
- **Introduction:** Write like a pitch:
  - Open with the problem (make it relatable)
  - Present the solution (make it sound elegant)
  - State the key result (make it concrete)
- **Architecture:** Include a clean ASCII diagram or high-level component map. Keep prose minimal — the diagram should tell the story. Show technical depth without getting into the weeds.
- **Implementation:** Cherry-pick 1-2 technically impressive components. Explain them at a level that demonstrates sophistication without requiring deep domain knowledge. Skip everything else.
- **Results:** Lead with quantified metrics:
  - Processing speed, data volumes, accuracy rates
  - Before/after comparisons
  - User-facing improvements
  - If no metrics exist, focus on capability demonstrations
- **Future Work:** Vision-oriented. Frame as "roadmap" or "what's next" rather than a bug list. Focus on exciting possibilities, not technical debt.

## Scale Adaptation

The six-section structure adapts to project size:

### Small (≤ 3 code files)

**Compact mode.** Output directly in conversation. Merge sections:
- Highlights (2-3 bullets)
- Introduction & Architecture (combined, 2-3 paragraphs)
- Implementation (key functions only)
- Results (if available)

Skip Conclusion & Future Work unless there are notable TODO/FIXME items.

### Medium (4-10 code files)

**Standard mode.** Full 6 sections, output in conversation. Each section
proportional to its content — don't pad thin sections.

### Large (11-50 code files)

**File mode.** Full 6 sections, output as `OVERVIEW.md` in the target directory.
Add a Table of Contents at the top. Architecture section gets expanded with
per-module descriptions.

### Very Large (> 50 code files)

**Architectural mode.** Group files by module/directory. Each module gets a
mini-summary (1-2 paragraphs). The six sections operate at the system level,
referencing modules rather than individual functions. Note which files were
analyzed in depth vs. skimmed.

## Tone and Style

- **Audience:** Default (no `--for` flag): write for a technically literate reader
  who has never seen this code. When `--for` is specified, follow the
  **Audience Adaptation** section above — it overrides the default audience
  assumptions for tone, terminology, and section depth.
- **Voice:** Direct, concrete, professional. Like a well-written technical report,
  not a marketing page. No filler phrases ("This is an interesting approach").
- **Terminology:** Use the code's own names (functions, variables, classes).
  When introducing a concept, define it briefly on first use.
- **Language:** Match the user's language. If the user writes in Chinese,
  output in Chinese (technical terms in original form). Default to English.
- **Length:** Let content determine length. A well-structured 300-line project
  might produce 2 pages. A 10,000-line project might produce 8 pages. Never
  pad to reach a length target.
- **Uncertainty:** When you're unsure about intent or behavior, say so.
  Use `[Inferred]`, `[Suggested]`, or "appears to" rather than stating guesses as facts.

## Integration

- **Hugo deploy:** When `--deploy` is used (gadget project only), stage the
  overview as Hugo content via `common.site_staging` conventions.
- **With /ccplan:** The overview document can serve as input for Phase 0
  (Context Scan) of a planning session.
- **With code-reviewer:** The Architecture section provides context for
  understanding code review findings.
