---
name: ccaudit
description: Repo-level dataflow bug audit (NPD/MLK/UAF) of a target C/C++/Java/Python/Go project via patched RepoAudit. Not for TypeScript targets.
---

# ccaudit — Repo-Level Bug Audit via RepoAudit

Run [PurCL/RepoAudit](https://github.com/PurCL/RepoAudit) — an LLM-agent
dataflow bug detector (dfbscan) — against a **target project**, powered by the
Claude Code CLI subscription (no API key). Detects:

| Bug type | Meaning | Applies to |
|----------|---------|-----------|
| NPD | Null Pointer Dereference | C/C++, Java, Python, Go |
| MLK | Memory Leak | C/C++ |
| UAF | Use After Free | C/C++ |

**Not supported**: TypeScript/JavaScript targets (RepoAudit limitation) —
including this repo itself. Use it on Python/C/C++/Java/Go projects.

## Usage

```
/ccaudit <target-path> [bug-type] [--lang <Language>]
```

- `bug-type` — NPD | MLK | UAF. Omit for language-appropriate defaults (below).
- `--lang` — C | Cpp | Java | Python | Go. Omit for auto-detection.

## Installation layout

- RepoAudit clone (pinned SHA, patched): `~/.devcompanion/tools/RepoAudit`
- Conda env: `repoaudit` (python 3.13)
- Patch: `cli-backend.patch` (this directory) adds an `infer_with_cli` backend
  to `src/llmtool/LLM_utils.py` — model name `claude-code` shells out to
  `claude -p` (prompt via stdin, JSON output, `--model $REPOAUDIT_CLI_MODEL`,
  default `sonnet`). A `codex-cli` seam exists but is experimental/untested.

## Workflow

### 1. Preflight (every run, read-only)

Check, in order; on any failure stop with the remediation message:

1. `~/.devcompanion/tools/RepoAudit/.ccaudit-setup-state.json` exists
   → else: "Run one-time setup: `bash skills/ccaudit/setup.sh`" (offer to run it).
2. `grep infer_with_cli ~/.devcompanion/tools/RepoAudit/src/llmtool/LLM_utils.py` succeeds
   → else patched tree is broken; suggest `setup.sh --force-reinstall`.
3. `claude` CLI on PATH.
4. Target path exists and is a directory.

### 2. Language detection

If `--lang` not given: count lines by extension in the target
(`.c/.h → C`, `.cpp/.cc/.hpp → Cpp`, `.java → Java`, `.py → Python`, `.go → Go`),
majority wins. If **no supported language** found (e.g. a TS repo), fail fast:
name the languages found and state RepoAudit's supported set. Never scan anyway.

### 3. Bug-type defaults + scope gate

- No bug-type arg: Python/Java/Go → `NPD` only; C/Cpp → `NPD, MLK, UAF`.
- Estimate scope: count functions (rough: `grep -c 'def '` for Python, etc.)
  and tell the user: N functions, ~M CLI calls per bug type, expected duration.
  For anything beyond a small repo (>200 functions), **ask for confirmation**
  before scanning (AskUserQuestion) — this burns subscription usage.

### 4. Run

For each selected bug type, from `~/.devcompanion/tools/RepoAudit/src`:

```bash
REPOAUDIT_CLI_MODEL=sonnet conda run -n repoaudit python repoaudit.py \
  --language <Lang> --model-name claude-code --scan-type dfbscan \
  --bug-type <TYPE> --project-path <absolute-target-path> \
  --temperature 0.0 --call-depth 3 --max-neural-workers 3
```

Notes:
- `--max-neural-workers 3` (NOT upstream's 30) — each worker is a `claude -p`
  subprocess sharing your usage window.
- Run bug types sequentially; each run is independently resumable.
- Long-running: use a background shell and poll.

### 5. Parse results (tri-state)

RepoAudit writes JSON + logs under its output/result directory (timestamped
per run — pick the newest matching this run). Distinguish:

- **crash** — process non-zero exit or no result dir → report the error, do not
  claim "no bugs".
- **zero findings** — clean result file with empty bug list → say so explicitly.
- **findings** — proceed to report.

### 6. Report

Write `<target>/.devcompanion/audit/repoaudit-<YYYY-MM-DD>.md` (create dirs;
never write into the target's `docs/`):

- Header: target, language, bug types, model, duration, RepoAudit SHA.
- Per finding: bug type, file:line, the propagation trace (source → sink), and
  a one-paragraph explanation derived from the JSON.
- Footer: raw JSON path for drill-down.

Chat summary: counts per bug type, top findings with file:line, report path,
duration. If the user wants triage (true/false-positive verification against
source), offer it as a follow-up — do not do it unasked.

## Failure handling

- Setup failures on Windows (tree-sitter build, torch): suggest VS Build Tools
  or running setup + scans under WSL.
- Mid-scan usage-limit errors: the patched backend retries with backoff; if a
  run still dies, re-run just that bug type.
- Patch no longer applies after changing the pinned SHA: re-derive the patch
  against the new `LLM_utils.py` (dispatch branch + `infer_with_cli` method).
