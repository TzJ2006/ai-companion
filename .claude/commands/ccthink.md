---
description: "New idea — align on intent, split into a graph, research prior art, design the tests, produce a week-by-week plan."
---

Read `D:/GitHub/ai-companion/claude-companion/FORMAT.md` first.

## Arguments

$ARGUMENTS

The idea to work through. If empty, ask for it before doing anything else.

## What you are doing

Turning one vague idea into a reviewed graph of small ideas, each with a plan
you could hand to someone else. **You write no code in this command.** The only
files you touch are `ideas/graph.yaml`, `ideas/graph.html` and `ideas/log.md`.

Six steps, in order. Do not skip ahead — each one exists because skipping it is
how rework happens.

---

## Step 1 — Align, at high altitude

Enter plan mode. Ask the human exactly three questions, and keep them **high
level** — this step is about the overall shape, not the details:

1. **要做什么** — what is this idea?
2. **预期结果是什么** — what is true when it's done?
3. **为什么要做这个** — what problem does it solve?

Ask them one at a time with AskUserQuestion, offering your best guess as an
option. Then write the three answers back in your own words and get an explicit
confirmation that you understood. **Do not proceed on silence.** If your
restatement is wrong, this is the cheapest moment in the whole project to find
out.

Before you ask, check the existing graph: `npx tsx D:/GitHub/ai-companion/claude-companion/ideas.ts check`
and read `ideas/graph.yaml`. If this idea already exists, or conflicts with one
that does, say so now and ask whether to extend that idea instead of adding one.

---

## Step 2 — Split into smaller ideas, and show the graph

The idea the human gave you is probably too big to be one node. Split it until
each node is one thing someone could finish and verify on its own.

For each new node write `id`, `name`, `needs`, and questions 1–3
(`what` / `why` / `expected`). Leave `how` and `why_this_way` empty — you have
not researched them yet, and filling them now is guessing.

Then render and **stop for review**:

```bash
npx tsx D:/GitHub/ai-companion/claude-companion/ideas.ts render
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

**b. On the web.** Has someone already built this? Use WebSearch. Look for:
existing libraries and tools that solve it, write-ups of people who tried and
what went wrong, and the standard approach in this domain.

**Borrowing takes priority over building. This is the highest-priority rule in
this command.** If something usable exists — a library, a pattern, a repository,
a documented approach — the plan borrows it. Building it yourself needs a stated
reason that survives being questioned. The only automatic exception is a project
the human has explicitly told you not to use.

Report each finding as: what it is, where it is, what it would save, what it
would cost, and your recommendation. Then let the human veto.

---

## Step 4 — Answer how, and why that way

Only now, for each node: `how` (the approach and mechanism) and `why_this_way`
(why this one over the alternatives you found in Step 3).

`why_this_way` must reference the alternatives you actually considered. "It's
simpler" is not a rationale; "chose X over Y because Y needs a server we don't
run" is. If you borrowed something in Step 3, say so here — that IS the
rationale.

Also fill `code`: the file and symbol where this will live. That is a
commitment, and `/ccbuild` writes to exactly there.

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
the test file.** `/ccbuild` writes it, first, before any implementation.

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

Then run `check` and `render`, and ask for approval — explicitly: they open
`ideas/graph.html`, and if the plan is right they reply with `批准` (or
`approve`) as their whole message. That reply is what unlocks implementation;
the guard refuses every write into an unapproved graph, and you cannot supply
that approval yourself. Editing the graph after approval lapses it, on purpose.

On approval, tell the human to run `/ccbuild`. On rejection, go back to
whichever step the objection lands in — usually Step 2 or Step 3.

## Recording

Append to `ideas/log.md`: date, `ccthink`, the idea, the nodes added, what was
borrowed and from where, and the week count.
