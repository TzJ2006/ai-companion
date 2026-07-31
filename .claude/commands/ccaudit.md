---
description: "Repo-level dataflow bug audit (NPD/MLK/UAF) of a TARGET project using a patched PurCL/RepoAudit powered by the claude CLI subscription. Targets C/C++/Java/Python/Go repos — NOT TypeScript. One-time setup via skills/ccaudit/setup.sh; per-run preflight, language-aware bug-type defaults, scope confirmation, and a markdown report in <target>/.devcompanion/audit/."
---

Read the full skill specification at `skills/ccaudit/SKILL.md`, then execute the /ccaudit workflow.

## Arguments

$ARGUMENTS

Expected: `<target-path> [bug-type] [--lang <Language>]`. If no target path is given, ask for one — never default to the current repo (it is TypeScript, which RepoAudit does not support).

## Execution

Follow `skills/ccaudit/SKILL.md` exactly:

1. **Preflight** — installed+patched RepoAudit at `~/.devcompanion/tools/RepoAudit`, `claude` CLI on PATH, valid target. If not installed, offer to run `bash skills/ccaudit/setup.sh`.
2. **Language detection** — majority-by-LOC among C/C++/Java/Python/Go; fail fast if none.
3. **Scope gate** — estimate function count and duration; confirm with the user before scanning large repos (>200 functions).
4. **Run** — `conda run -n repoaudit python repoaudit.py --model-name claude-code --max-neural-workers 3 ...` per selected bug type, sequentially, in a background shell.
5. **Report** — tri-state result parsing (crash / zero findings / findings); write `<target>/.devcompanion/audit/repoaudit-<date>.md` and summarize in chat.

**Boundaries:** never scan TypeScript targets; never raise worker count above 3; never write into the target's `docs/`; prompt content must never be shell-interpolated (the patch handles this — do not "fix" it).
