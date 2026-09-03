---
name: idea-discuss
description: >-
  Aligns a new idea at high level (what / expected result / why), splits it into
  a reviewable idea graph, researches reuse and prior art, then writes how,
  why-this-way, a test design, and a week-by-week plan. Use when starting a new
  idea, aligning requirements, planning a feature, 对齐需求, 新想法, or the user
  says discuss or /idea-discuss. Do not write product code. Do not use for
  onboarding (/idea-onboard), implementation (/idea-build), or a failing test
  (/idea-debug).
icon: search
color: purple
---

# /idea-discuss — New ideas Discussion

Read `.cursor/companion/FORMAT.md` (or `cursor-companion/FORMAT.md`) first.

## Engine

```bash
npx tsx .cursor/companion/ideas.ts <cmd>
```

If that path does not exist, try `npx tsx cursor-companion/ideas.ts`. If neither
exists, stop and tell the human to run `npx tsx cursor-companion/install.ts .`.

## Arguments

The idea to work through. If empty, ask for it before doing anything else.

## What you are doing

Turning one vague idea into a reviewed graph of small ideas, each with a plan
you could hand to someone else. **You write no product code.** The write-gate
will deny it. The only files you touch are this companion's ledger: `ideas/graph.yaml` (or
`ideas/graph.cursor.yaml` if that name was taken), plus the matching `log.md` /
`graph.html`. `npx tsx .cursor/companion/ideas.ts paths` prints them. The ledger
is always allowed. Never write another agent's `graph.claude.yaml` / `graph.codex.yaml`.

Six steps, in order. Do not skip ahead — each one exists because skipping it is
how rework happens.

---

## Step 1 — Align, at high altitude

If a mode switch tool is available, switch to **plan** for this step. In Cursor,
plan mode is read-only — do not write files until you switch back to agent
after the human confirms the three answers. If you cannot switch, stay in agent
and treat product code as frozen anyway.

Ask the human exactly three questions, and keep them **high level** — this step
is about the overall shape, not the details:

1. **要做什么** — 这个想法是什么
2. **预期结果是什么** — 这个想法的预期结果是什么
3. **为什么要做这个事情** — 为什么有这个想法

Ask them one at a time with the structured question tool, offering your best
guess as an option. Then write the three answers back in your own words and get
an explicit confirmation that you understood. **Do not proceed on silence.**
If your restatement is wrong, this is the cheapest moment in the whole project
to find out.

Before you ask, check the existing graph:

```bash
npx tsx .cursor/companion/ideas.ts check
```

and read `ideas/graph.yaml`. If this idea already exists, or conflicts with one
that does, say so now and ask whether to extend that idea instead of adding one.

---

## Step 2 — Split into smaller ideas, and show the graph

The idea the human gave you is probably too big to be one node. Split it until
each node is one thing someone could finish and verify on its own.

For each new node write `id`, `name`, `needs`, and questions 1–3
(`what` / `why` / `expected`). Leave `how` and `why_this_way` empty — you have
not researched them yet, and filling them now is guessing.

Use `ideas.ts new "短名称" --needs I-001,I-002` to allocate ids, then fill the
fields in `ideas/graph.yaml`. Switch back to agent if you were in plan mode,
because this step writes the graph.

Then render and **stop for review**:

```bash
npx tsx .cursor/companion/ideas.ts render
```

Show the human the graph and ask directly: *is this the right decomposition?*
Point at the three things a picture makes judgeable — nodes that do too much,
edges that are missing, and nodes that lead nowhere. Wait for approval or edits.
Do not start research on a decomposition nobody has agreed to.

---

## Step 3 — Research, before you decide anything

Two searches, in this order. Both are mandatory; report both even when empty.

**a. In this project.** Grep and read. What already exists that does this or
part of it? What can be reused, extended, or copied? List the files.

**b. On the web.** Has someone already built this? Use web search. Look for:
existing libraries and tools that solve it, write-ups of people who tried and
what went wrong, and the standard approach in this domain.

**借鉴的优先级是最高的。Borrowing takes priority over building.** If something
usable exists — a library, a pattern, a repository, a documented approach —
the plan borrows it. Building it yourself needs a stated reason that survives
being questioned. The only automatic exception is a project the human has
explicitly told you not to use.

Report each finding as: what it is, where it is, what it would save, what it
would cost, and your recommendation. Then let the human veto.

---

## Step 4 — Answer how, and why that way

Only now, for each smaller idea, in detail:

1. **要如何实现这个想法？** → `how`
2. **为什么要这样实现这个想法？** → `why_this_way`

`why_this_way` must reference the alternatives you actually considered. "It's
simpler" is not a rationale; "chose X over Y because Y needs a server we don't
run" is. If you borrowed something in Step 3, say so here — that IS the
rationale.

Also fill `code`: the file and symbol where this will live. That is a
commitment, and `/idea-build` writes to exactly there. Fill `future` too.

---

## Step 5 — Design the test, don't write it

For every node: **assuming this were implemented, how would we know it matches
`expected`?**

Write it into `verify`:

```yaml
verify: { command: "npx vitest run tests/x.test.ts", pass: "exit 0" }
```

Describe in your report what that test would assert — the inputs, the expected
output, the edge case that would catch a wrong implementation. **Do not write
the test file.** `/idea-build` writes it, first, before any implementation.

When something genuinely cannot be checked by a machine, use
`verify: { manual: "..." }` and say plainly what a human will have to look at.
A manual check is an honest admission, not a failure — but a fake test command
is a lie the whole pipeline then relies on.

---

## Step 6 — The plan, by week

Present the whole thing for review:

1. **The three answers from Step 1** — the alignment everything rests on.
2. **The graph** — path to `ideas/graph.html`, node count, the shape.
3. **Borrowed vs built** — the Step 3 table, with what each borrow saves.
4. **Per node**: how, why that way, and what its test will assert.
5. **A week-by-week schedule.** Group the nodes into weeks in topological
   order — a node cannot be scheduled before the week its prerequisites finish.
   For each week: which nodes, what is demonstrable at the end of it, and what
   could go wrong. Say plainly which weeks are guesses.
6. **The risks** — what would make this plan wrong, and what you would do then.

Then run `check` and `render`, and ask for approval. On approval, tell the human
to run `/idea-build`. On rejection, go back to whichever step the objection
lands in — usually Step 2 or Step 3.

## Recording

```bash
npx tsx .cursor/companion/ideas.ts log --by idea-discuss --ideas I-001,I-002 --note "aligned X; borrowed Y from Z; N-week plan"
```
