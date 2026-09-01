---
description: "Onboarding — read the whole project and turn it into an idea graph you can study."
---

Read `D:/GitHub/ai-companion/claude-companion/FORMAT.md` first. It defines the node format; do not invent your own.

## Arguments

$ARGUMENTS

A path scopes the scan to that directory. `--refresh` updates an existing
`ideas/graph.yaml` instead of starting over. No arguments = the whole project.

## What you are doing

Turning a pile of files into a graph of ideas, so the human can see the shape of
their own project and re-enter it cold months later.

## Step 1 — Read everything

Build the worklist first, then work it down to zero:

```bash
npx tsx D:/GitHub/ai-companion/claude-companion/ideas.ts scan          # 建清单 + 看还剩多少
npx tsx D:/GitHub/ai-companion/claude-companion/ideas.ts scan --n 0    # 打印全部剩余
```

Every file you `Read` is struck off the list automatically — by the hook, not by
you. You cannot cross a file off any other way, which means the remaining count
is a fact rather than your estimate of your own thoroughness. Keep calling `scan`
to see what is left, and keep reading until it prints `全部读完`.

**Do not sample.** Read roughly in this order, because later sources explain
earlier ones:

1. `README`, `CLAUDE.md`, `AGENTS.md`, `docs/` — the stated intent.
2. Config and manifests — the real dependency structure.
3. All source, including tests. Tests tell you the `expected` of question 3
   better than any prose does.
4. `git log` — intent lives in commit messages, especially the angry ones.

If the project is too big for one context, read it in batches — the worklist is
the resume point, so a compaction costs you nothing. Write ideas into
`ideas/graph.yaml` as you go rather than holding them all in your head.

End this step by reporting the **actual numbers from `scan`**: how many files
read, how many remain. If you are stopping with files still on the list, say
which directories they are in and why you are stopping. A graph built from a
partial read is worse than no graph, because it looks complete.

## Step 2 — Name the endpoints

Ask the human: **what does "done" look like for this project?** One to three
terminal deliverables. Everything else in the graph exists to reach one of them.

Use AskUserQuestion. Offer your inferred answers as options — the human
correcting a wrong guess is faster than the human writing from scratch.

## Step 3 — Extract the ideas

An idea is a chunk of intent that produces something you would ship, demo, or
point at. Not a file. Not a function. If your node list looks like the directory
tree, you have recorded the structure and none of the thinking.

给每个想法一个 `I-NNN` 编号和一个完整人话句子的 `name` —— 图上只显示名称，
它必须让从没打开过这个仓库的人看懂：写它做什么（「算出现在可以立刻动手做的
想法有哪些」），不写行话标签（「前沿查询」），也不写代码位置（「ast package」）。
FORMAT.md 里「How to write the graph」的规则适用于所有叙述字段，不只是名称。

## Step 4 — Draw the edges

`needs:` lists every idea that must be done first. Keep it acyclic. Two ideas
that need each other are one idea — merge them.

## Step 5 — Answer the eight questions

For every node. The rules that matter:

- **`why_this_way` is where you will be tempted to lie.** Look for the real
  reason in comments, commit messages, and design docs. When you cannot find
  it, write `why_this_way: null` and list that node in your report. An invented
  rationale gets read as fact by the next agent and defended forever.
- **`code` must resolve.** Real file, real line numbers. `/ccfix` trusts these.
- **`verify`** — the existing test if there is one; otherwise
  `manual:` describing what a human would have to look at. Do not invent a test
  command that does not exist.
- **`expected`** — from the tests and docs. If neither says, ask, or mark it
  unanswered.
- **`status`** — `done` for what already works, `todo` for what the code or docs
  clearly intend but have not built.

## Step 6 — Check, render, hand over

```bash
npx tsx D:/GitHub/ai-companion/claude-companion/ideas.ts check
npx tsx D:/GitHub/ai-companion/claude-companion/ideas.ts render
npx tsx D:/GitHub/ai-companion/claude-companion/ideas.ts next
```

Fix every error `check` reports before you show anything to the human.

Then report, in this order:
1. **Scan coverage** — the numbers `scan` prints, not your impression.
2. The endpoints and how many ideas lead to each.
3. Status counts, and the current frontier (what is ready to work on).
4. **Every node where `why_this_way`, `expected` or `verify` came back
   unanswered.** This list is the agenda for the next `/ccthink`, and it is the
   most valuable thing this command produces.
5. The path to `ideas/graph.html`.

Then ask the human to open it and review the graph. Say plainly that nothing
can be implemented until they reply with `批准` (or `approve`) as their whole
message — the guard blocks every write into an unapproved graph, and you cannot
give that approval on their behalf. If they change the graph afterwards, the
approval lapses and they will be asked again.

## Recording

Append one entry to `ideas/log.md`: date, `ccscan`, files read, ideas created,
open questions. See the Recording section of `D:/GitHub/ai-companion/claude-companion/README.md`.

## Boundaries

`/ccscan` writes `ideas/graph.yaml`, `ideas/graph.html` and `ideas/log.md`.
It does not touch source code, does not create tests, and does not refactor
anything. Building ideas is `/ccbuild`.
