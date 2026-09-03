---
name: idea-onboard
description: >-
  Reads every file, document, comment, and line of a project, extracts ideas as
  graph nodes (eight questions each), and writes ideas/graph.yaml plus a
  clickable ideas/graph.html. Use when onboarding, understanding a codebase,
  mapping a project, building an idea graph, 模块化, 想法图, or the user says
  onboard or /idea-onboard. Do not use for a new feature (use /idea-discuss),
  implementation (use /idea-build), or a failing test (use /idea-debug).
icon: book-open
color: blue
---

# /idea-onboard — Onboarding

Read `.cursor/companion/FORMAT.md` (or `cursor-companion/FORMAT.md`) first. It
defines the node format; do not invent your own.

## Engine

```bash
npx tsx .cursor/companion/ideas.ts <cmd>
```

If that path does not exist, try `npx tsx cursor-companion/ideas.ts`. If neither
exists, stop and tell the human to run `npx tsx cursor-companion/install.ts .`.

## Arguments

The user's text after `/idea-onboard`. A path scopes the scan to that directory.
`--refresh` updates this companion's existing graph (`ideas/graph.yaml` or
`ideas/graph.cursor.yaml` if that name was taken) instead of starting over.
No arguments = the whole project.

## What you are doing

Turning a pile of files into a graph of ideas, so the human can see the shape of
their own project and re-enter it cold months later.

## Step 1 — Read everything

Every source file, every document, every comment. **Do not sample.** Read in
this order, because later sources explain earlier ones:

1. `README`, `AGENTS.md`, `CLAUDE.md`, `docs/` — the stated intent.
2. Config and manifests — the real dependency structure.
3. All source, including tests. Tests tell you the `expected` of question 3
   better than any prose does.
4. `git log` — intent lives in commit messages, especially the angry ones.

If the project is too large to read in one context, read it in passes by
directory and keep notes in `ideas/graph.yaml` as you go — but **never claim
coverage you do not have.** End this step by stating: how many files you read,
how many you skipped, and why. A graph built from a partial read is worse than
no graph, because it looks complete.

## Step 2 — Name the endpoints

Ask the human: **what does "done" look like for this project?** One to three
terminal deliverables. Everything else in the graph exists to reach one of them.

Use the structured question tool. Offer your inferred answers as options — the
human correcting a wrong guess is faster than the human writing from scratch.

## Step 3 — Extract the ideas

An idea is a chunk of intent that produces something you would ship, demo, or
point at. Not a file. Not a function. If your node list looks like the directory
tree, you have recorded the structure and none of the thinking.

Give each an `I-NNN` id (`ideas.ts new` allocates the next one) and a short
`name` — the name is all the graph shows, so it must read as an idea
("函数级变更追踪"), not as a location ("ast package").

## Step 4 — Draw the edges

`needs:` lists every idea that must be done first. If idea A is a prerequisite
of idea B, A is in B's `needs`, and the HTML graph draws an arrow from A to B.
Keep it acyclic. Two ideas that need each other are one idea — merge them.

## Step 5 — Answer the eight questions

For every node, in this order:

1. 这个想法是什么
2. 为什么有这个想法
3. 这个想法的预期结果是什么
4. 要如何实现这个想法
5. 为什么要这样实现这个想法
6. 这个想法的具体实现的代码在哪个文件的那几行
7. 当这个想法实现了之后要如何验证这个想法就是我想要的预期结果
8. 这个想法所实现的东西未来可以如何使用

The rules that matter:

- **`why_this_way` is where you will be tempted to lie.** Look for the real
  reason in comments, commit messages, and design docs. When you cannot find
  it, write `why_this_way: null` and list that node in your report. An invented
  rationale gets read as fact by the next agent and defended forever.
- **`code` must resolve.** Real file, real line numbers. `/idea-debug` trusts these.
- **`verify`** — the existing test if there is one; otherwise
  `manual:` describing what a human would have to look at. Do not invent a test
  command that does not exist.
- **`expected`** — from the tests and docs. If neither says, ask, or mark it
  unanswered.
- **`status`** — `done` for what already works, `todo` for what the code or docs
  clearly intend but have not built.

## Step 6 — Check, render, hand over

```bash
npx tsx .cursor/companion/ideas.ts check
npx tsx .cursor/companion/ideas.ts render
npx tsx .cursor/companion/ideas.ts next
```

Fix every error `check` reports before you show anything to the human.

Then report, in this order:

1. The endpoints and how many ideas lead to each.
2. Status counts, and the current frontier (what is ready to work on).
3. **Every node where `why_this_way`, `expected` or `verify` came back
   unanswered.** This list is the agenda for the next `/idea-discuss`, and it
   is the most valuable thing this command produces.
4. The path to `ideas/graph.html`.

## Recording

```bash
npx tsx .cursor/companion/ideas.ts log --by idea-onboard --note "files read N, ideas created M, open questions: ..."
```

## Boundaries

`/idea-onboard` writes `ideas/graph.yaml`, `ideas/graph.html` and `ideas/log.md`.
It does not touch source code, does not create tests, and does not refactor
anything. Building ideas is `/idea-build`.
