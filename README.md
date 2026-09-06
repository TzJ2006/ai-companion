# ai-companion

AI Companion source repository. On 2026-09-05, all discovered local Companion installations, hooks, installed skills, and legacy commands were retired at the owner's request; later the same day the base was installed here again. This checkout is running its own guard: `.companion/companion.mjs`, wired into five hook events in `.claude/settings.json` and into `.cursor/hooks.json` and `.codex/hooks.json`, with the five skills installed under `.claude/skills/` and `.agents/skills/`. It really refuses commands in this repository.

## Current source

- `companion/` holds the latest shared engine, renderer, guard, installer, and skill sources for further development. Skill files here are source files, not installed skills.
- `.devcompanion/tests/` holds the current test suite; run `npm test`.
- `ideas/graph.yaml` and `ideas/log.md` retain the current project reasoning.
- `archive/` is empty. The retired implementations that had been tracked survive only in git history, as the files commit 48e1f51 deleted (`git show 48e1f51^:archive/...`). `archive/retired-20260905/` and `archive/retired-20260905-after-pause/` were never in version control — `.gitignore` excludes `archive/` — and are gone. The live installation is `.companion/`, not anything under `archive/`.

## Changes landed on 2026-09-05

The ccscan reading workflow is unchanged. Thoughts form a tree: `parent` names the thought an idea sits under, at most seven top-level thoughts and at most seven direct children per thought (fewer are fine). The page is one file, one page per thought addressed by `#I-xxx`: the home page shows the top level; a thought's page shows its own eight questions and its children's dependency diagram.

Each thought is approved once, on its complete content (name, parent, prerequisites, the eight answers; code down to the symbol, verification without the signature). Approval persists while that content is unchanged: sessions, retries, status, logs, test results, line numbers written back after implementing, signatures, and unrelated thoughts do not invalidate it. One challenge may name several thoughts; each is approved on its own. Changing a thought's content requires renewed approval for that thought only.

Reinstallation is a separate action. Do not automatically reinstall hooks or skills while working on the source.