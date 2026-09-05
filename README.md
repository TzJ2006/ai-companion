# ai-companion

AI Companion source repository. On 2026-09-05, all discovered local Companion installations, hooks, installed skills, and legacy commands were retired at the owner's request. This checkout is not running its own guard.

## Current source

- `companion/` holds the latest shared engine, renderer, guard, installer, and skill sources for further development. Skill files here are source files, not installed skills.
- `.devcompanion/tests/` holds the current test suite; run `npm test`.
- `ideas/graph.yaml` and `ideas/log.md` retain the current project reasoning.
- `archive/` holds retired implementations. `archive/retired-20260905/` additionally holds removed repository installations, original configuration files, retired worktrees, and historical graph, tracker, and ECL records. `archive/retired-20260905-after-pause/` holds the installation another session regenerated before it was paused. Nothing there is an active installation.

## Agreed next changes (not implemented yet)

Keep the full ccscan reading workflow. Present thoughts as an expandable hierarchy, with at most seven top-level thoughts and at most seven direct children per thought; fewer are fine.

Approve the complete content of each thought once. Approval persists while that thought's content is unchanged. Session changes, retries, execution status, logs, test results, and unrelated thoughts must not invalidate it. Changed thought content requires renewed approval for that thought only.

Reinstallation is a separate action. Do not automatically reinstall hooks or skills while working on the source.