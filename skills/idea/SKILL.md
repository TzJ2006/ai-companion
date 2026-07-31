---
name: idea
description: >-
  Record, inspect, and research ideas in the current project's AI Dev Companion
  backlog. Use for idea add, list, show, and research workflows.
---

# Idea Backlog Management

Manage the current project's idea backlog in `.devcompanion/ideas/`.

## Commands

- `add <title>`: collect a description and optional comma-separated tags, then run
  `node packages/cli/dist/main.js idea add "<title>" -d "<description>" -t "<tags>" -p .`.
- `list`: run `node packages/cli/dist/main.js idea list -p .`.
- `show <slug>`: run `node packages/cli/dist/main.js idea show <slug> -p .`.
  Add `--report` to display its research report.
- `research <slug>`: obtain confirmation before running
  `node packages/cli/dist/main.js idea research <slug> -m sonnet -p .`; it calls
  the configured Claude CLI and writes `<slug>-research.md` beside the idea.

If no valid subcommand is supplied, show this short menu. Always report the
created slug or result path. Ideas use the statuses `draft`, `researching`,
`researched`, `failed`, and `archived`.
