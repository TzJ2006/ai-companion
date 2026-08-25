---
name: idea-record
description: >-
  Appends a structured entry to ideas/log.md recording what code, documents,
  and ideas changed and why. Use after every companion workflow step, when
  the user says record, 记一下, log the change, or /idea-record. The after-edit
  hook already lists files; this skill records the reason.
icon: file-text
color: cyan
disable-model-invocation: true
---

# /idea-record — Recording

Read `.cursor/companion/FORMAT.md` (or `cursor-companion/FORMAT.md`) first.

## Engine

```bash
npx tsx .cursor/companion/ideas.ts log --by <skill> --ideas I-001 --files a.ts,b.md --note "why"
```

If that path does not exist, try `npx tsx cursor-companion/ideas.ts`.

## What you are doing

Keeping one append-only trail of every change: code, documents, and ideas.
The after-edit hook already writes *which file* changed. You write *why*,
*which idea*, and *what the human should know*.

Do this at the end of `/idea-onboard`, `/idea-discuss`, `/idea-build`, and
`/idea-debug`, and any time you change `ideas/graph.yaml` outside those skills.

## What to put in the note

One to five lines covering:

- which ideas (`I-NNN`) moved, and their new status
- which source files and which docs
- the reason, in a sentence a future session can act on
- for `/idea-debug`: step 1 (code wrong / idea stale) or step 2 (idea wrong),
  plus the root cause

Do not dump diffs. The hook has the file list; git has the diff.

## Idea-local log

Status changes already append to the node's `log:` via `ideas.ts set`. If you
edit an idea's eight answers without changing status, add a `log:` item on
that node by hand (date, by, note) so the reason sits next to the idea.

## Do not

- rewrite `ideas/log.md` — only append
- log `ideas/log.md` or `ideas/graph.html` (generated / the log itself)
- invent a second log file
