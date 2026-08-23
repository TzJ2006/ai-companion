---
name: ccoverview
description: Generate the current project's AI Dev Companion overview report without reimplementing the renderer.
---

# AI Dev Companion Codex Adapter: ccoverview

Read `../../../skills/ccoverview/SKILL.md` and run its existing generator. Use
`--skip-translation` when the Claude CLI is unavailable (English `overview.html`,
no LLM); do not reimplement the report or translation pipeline. `--target` is
allowed; when omitted, the generator overviews the current project (cwd / git
root), not the companion checkout.
