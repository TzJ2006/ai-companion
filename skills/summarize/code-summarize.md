---
name: code-summarize
description: >
  Slash command for generating paper-style code overview documents. Defaults to ./
  when no argument is given. Accepts a folder path or single file.
trigger: /code-summarize
---

# /code-summarize

Generate a paper-style overview document for a code project or directory.

## Usage

```
/code-summarize                           # Overview of current directory (./)
/code-summarize src/                      # Overview of a specific directory
/code-summarize path/to/file.py           # Overview of a single file
/code-summarize --deploy                  # Generate + deploy to Hugo (gadget only)
/code-summarize src/ --deploy             # Specific directory + deploy
/code-summarize --for self                # Author review perspective
/code-summarize --for coworker            # Team collaboration perspective
/code-summarize --for user                # End-user / API consumer perspective
/code-summarize --for display             # Showcase / presentation perspective
/code-summarize src/ --for user --deploy  # Combined flags
```

## Behavior

### 1. Argument Parsing

- **No argument:** Default to `./` (current working directory)
- **Directory path:** Enter folder scan mode
- **Single file path:** Summarize that file directly (always compact mode)
- **`--deploy` flag:** After generating the overview, stage it as Hugo content
  using `outputs/site/` conventions. Only functional in the gadget project.
- **`--for <audience>` flag:** Tailor the overview for a specific reader type.
  Valid values: `self`, `coworker`, `user`, `display`. When omitted, defaults
  to `general` (current behavior — technically literate reader unfamiliar with
  the code). See the **Audience Adaptation** section in `SKILL.md` for detailed
  per-audience section guidelines.

### 2. File Discovery

Recursively scan the target directory for code files by extension.

**Supported extensions:**
`.py`, `.js`, `.ts`, `.tsx`, `.jsx`, `.go`, `.rs`, `.java`, `.kt`, `.c`, `.cpp`,
`.h`, `.hpp`, `.cs`, `.rb`, `.php`, `.swift`, `.scala`, `.sh`, `.bash`, `.zsh`,
`.ps1`, `.lua`, `.r`, `.R`, `.sql`, `.vue`, `.svelte`

**Also scan (for context, not counted as code files):**
`.yaml`, `.yml`, `.toml`, `.json`, `.xml`, `.md`, `Dockerfile`, `Makefile`,
`CMakeLists.txt`, `.gitignore`

**Excluded directories (always skip):**
`node_modules/`, `.git/`, `__pycache__/`, `.venv/`, `venv/`, `env/`,
`build/`, `dist/`, `.next/`, `.nuxt/`, `target/`, `out/`,
`.tox/`, `.mypy_cache/`, `.pytest_cache/`, `.cache/`,
`vendor/`, `deps/`, `_deps/`, `.idea/`, `.vscode/`,
`coverage/`, `.nyc_output/`, `htmlcov/`, `outputs/`

Respect `.gitignore` patterns when possible.

### 3. Context Gathering (Before Writing)

Before generating any section, gather contextual data:

1. **Project metadata:** Read `README.md`, `CLAUDE.md`, `pyproject.toml`,
   `package.json`, `Cargo.toml`, `go.mod`, or equivalent
2. **Entry points:** Identify `main.py`, `index.ts`, `main.go`, `src/main.rs`,
   CLI entry points, `if __name__ == "__main__"` blocks
3. **Output artifacts:** Scan `outputs/`, `results/`, `dist/`, `logs/`,
   `build/` for existing results
4. **Tests:** Check for test directories, coverage reports, CI configs
5. **TODOs:** Grep for `TODO`, `FIXME`, `HACK`, `XXX` comments
6. **Git context:** Recent commit messages (last 10) for development trajectory

### 4. Output Strategy

Based on the number of discovered **code files** (not context files):

| Code Files | Mode | Output |
|-----------|------|--------|
| 1 file | Compact | In conversation, merged sections |
| 2-3 files | Compact | In conversation, merged sections |
| 4-10 files | Standard | In conversation, full 6 sections |
| 11-50 files | File | `OVERVIEW.md` in target directory |
| > 50 files | Architectural | `OVERVIEW.md`, module-grouped analysis |

### 5. Audience Resolution

If `--for <audience>` is specified:

1. Load the **Audience Adaptation** section from `SKILL.md`
2. Apply the **Section Weight Matrix** to determine depth per section
3. Follow the **Per-Audience Section Guidelines** for content and tone
4. Apply audience-specific section merging/omission rules:
   - `user`: merge Architecture + Implementation into brief "How It Works"
     (unless project has > 10 code files, then keep separate but compressed)
   - `display`: may omit Implementation entirely for small projects
   - `self` and `coworker`: always keep all 6 sections

If `--for` is not specified, skip this step (default `general` behavior).

### 6. Document Generation

Follow the six-section structure defined in `SKILL.md`:

1. **Highlights** — 3-5 key bullets
2. **Introduction** — What, why, for whom
3. **Architecture** — Structure, data flow, dependencies
4. **Implementation** — Key algorithms and functions
5. **Results** — Outputs, examples, performance (3-tier sourcing)
6. **Conclusion & Future Work** — Status assessment + grounded next steps

**Section ordering is fixed.** Never reorder sections.

**Section omission rules:**
- Compact mode: merge Introduction & Architecture; skip Conclusion & Future Work
  if no TODOs/FIXMEs found
- Standard/File mode: all 6 sections required (may be brief if content is thin)
- Never omit Highlights or Introduction in any mode

### 7. Results Section — Data Sourcing Protocol

This is the section most likely to vary in quality. Follow the tier system strictly:

**Tier 1 — Read actual output files:**
```
Look in: outputs/, results/, dist/, build/, logs/, *.csv, *.json (output),
         screenshots/, images/, reports/
```
Summarize what you find. Quote interesting excerpts. Report file counts, sizes,
dates.

**Tier 2 — Read documented examples:**
```
Look in: README.md (Usage/Examples sections), docs/, examples/,
         test fixtures, demo scripts
```
Extract usage patterns and expected output.

**Tier 3 — Infer from code:**
Describe expected behavior based on code logic. Always prefix with
`[Inferred from code]` or `[基于代码逻辑推断]`.

**If all three tiers are empty:** Write a brief note:
> "No output artifacts, usage examples, or test results were found in the
> repository. Run the project and re-run `/code-summarize` for a richer
> Results section."

### 8. Large Codebase Handling (> 50 files)

For very large codebases:

1. **Module-first approach:** Identify top-level modules/packages/directories
2. **Per-module mini-summary:** 1-2 paragraphs each, covering purpose and key exports
3. **System-level six sections:** Architecture and Implementation sections reference
   modules rather than individual functions
4. **Prioritize entry points:** Analyze `main`, CLI, API routes, and public
   interfaces in depth; note peripheral code as "scanned but not deeply analyzed"
5. **Note coverage:** State which percentage of the codebase was analyzed in detail

### 9. Hugo Deploy (gadget only)

When `--deploy` flag is present:

1. Generate the `OVERVIEW.md` content as normal
2. Stage as Hugo content under `outputs/site/content/posts/` with appropriate
   frontmatter (title, date, tags)
3. Report the staged file path for later Hugo build

This feature depends on the gadget project's `common.site_staging` and Hugo
infrastructure. Outside gadget, `--deploy` is ignored with a warning.

## Examples

```
User: /code-summarize
→ Scans ./, finds 6 Python files
→ Standard mode: outputs full 6-section overview in conversation

User: /code-summarize research/
→ Scans research/, finds 12 Python files
→ File mode: generates research/OVERVIEW.md

User: /code-summarize --deploy
→ Scans ./, generates overview
→ Also stages Hugo content in outputs/site/

User: /code-summarize utils.py
→ Single file: compact mode in conversation
```
