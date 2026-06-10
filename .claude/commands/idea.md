---
description: "Record ideas and trigger research. Use: /idea add <title>, /idea list, /idea research <slug>, /idea show <slug>"
---

## Idea Backlog Management

Manage the project's idea backlog stored at `.devcompanion/ideas/`.

## Arguments

$ARGUMENTS

## Commands

Based on the arguments, execute one of the following:

### `add <title>` or just a description of an idea

Record a new idea. Ask the user for:
1. A clear title (if not provided in arguments)
2. A description explaining what the idea is and why it matters
3. Optional tags (comma-separated)

Then run:
```bash
node packages/cli/dist/main.js idea add "<title>" -d "<description>" -t "<tags>" -p .
```

Report the created slug back to the user.

### `list`

List all ideas with their status:
```bash
node packages/cli/dist/main.js idea list -p .
```

### `show <slug>`

Show idea details:
```bash
node packages/cli/dist/main.js idea show <slug> -p .
```

Add `--report` to show the research report instead of idea details.

### `research <slug>`

Trigger research on an idea. Confirm with the user before starting (it calls Claude API and takes 1-2 minutes). Then run:
```bash
node packages/cli/dist/main.js idea research <slug> -m sonnet -p .
```

Report the result path when complete, or the failure reason if it fails.

### No arguments or unrecognized input

If the user just types `/idea` with no clear command, show a brief menu:
- `add` — record a new idea
- `list` — show all ideas
- `show <slug>` — view idea details
- `research <slug>` — run research on an idea

## Behavior Notes

- Always use `-p .` to target the current project root
- The idea store is at `.devcompanion/ideas/`
- Research reports are saved as `<slug>-research.md` in the same directory
- Status icons: ○ draft, ◐ researching, ● researched, ✗ failed, ◌ archived
