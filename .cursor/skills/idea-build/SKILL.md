---
name: idea-build
description: >-
  Implements approved idea-graph nodes in topological order: write the test
  first, then the code at the planned file/symbol, verify, then mark the node
  done. Use when implementing an approved idea, building the frontier, 实现想法,
  or the user says build or /idea-build. Do not use for a new unaligned idea
  (/idea-discuss), onboarding (/idea-onboard), or a mismatch after three
  failed verifies (/idea-debug).
icon: rocket
color: green
---

# /idea-build — 实现想法

Read `.cursor/companion/FORMAT.md` (or `cursor-companion/FORMAT.md`) first.

## Engine

```bash
npx tsx .cursor/companion/ideas.ts <cmd>
```

If that path does not exist, try `npx tsx cursor-companion/ideas.ts`. If neither
exists, stop and tell the human to run `npx tsx cursor-companion/install.ts .`.

## Arguments

An idea id builds just that one. `--all` keeps going until the frontier is empty
or something blocks. No arguments = build the current frontier, then stop and
report.

## What you are doing

Walking the graph in topological order and turning `todo` ideas into `done`
ones. The graph decides the order; you do not.

## Step 0 — Where are we

```bash
npx tsx .cursor/companion/ideas.ts check
npx tsx .cursor/companion/ideas.ts next
```

`check` must pass before you build anything. `next` prints the frontier — the
`todo` ideas whose prerequisites are all `done`. If it is empty, report why
(everything done, or everything blocked) and stop.

Independent frontier ideas may be built in parallel with subagents. Two ideas
whose `code` names the same file are **not** independent — build those one at a
time, in id order.

## Step 1 — Read the idea

```bash
npx tsx .cursor/companion/ideas.ts show <id>
```

All eight answers. If `how`, `expected` or `verify` is unanswered, **stop and
route to `/idea-discuss`** — an idea that has not been thought through is not
ready to be built, and building it anyway is how you end up with code nobody
can explain.

Set the idea `doing` before you touch files. The write-gate will deny any
product-code edit until this succeeds (`how` / `expected` / `verify` /
`code.file` required, prerequisites must be `done`):

```bash
npx tsx .cursor/companion/ideas.ts set <id> doing --by idea-build --note "starting"
npx tsx .cursor/companion/ideas.ts allow <file>   # confirm the file is unlocked
```

## Step 2 — Write the test FIRST

Before any implementation. This is not negotiable and it is the point of the
whole command.

1. Write the test file named in `verify.command`, asserting what `expected`
   says — the real inputs and the real outputs, not a placeholder.
2. **Run it. It must fail**, and it must fail because the thing does not exist
   yet, not because the test is broken. Read the failure and confirm that.
3. If it passes, the idea is already built. Stop, and either mark it `done` with
   a log entry explaining, or go back to `/idea-discuss` because the idea meant
   something else.

For `verify: { manual: ... }` there is no test to write. Say so, and remember
this idea cannot be marked `done` without a human signature.

## Step 3 — Implement

Write the code at the `file` and `symbol` in `code`. Only what this idea needs.

An idea that turns out to need something not in `needs` is a hole in the graph:
stop, tell the human, add the edge, and let the frontier reorder. Do not quietly
build the prerequisite too — that is how a graph stops describing the project.

## Step 4 — Verify

Run `verify.command`.

- **Passes** → run the wider test suite too. A change that breaks another idea
  is not done. If it breaks something, that is a `/idea-debug` job, not a
  "fix it quickly here" job.
- **Fails** → up to three attempts, each with a stated reason for what you
  changed. After three, set the idea `blocked` and hand it to `/idea-debug`.

**Never edit the test to make it pass.** The test is question 7; changing it
changes what the idea means. If the test is genuinely wrong, that is a finding
to take to the human, not a thing to quietly correct.

## Step 5 — Mark it done

Fill in the real line numbers first — question 6 is only worth something if it
resolves:

```yaml
code:
  - file: src/thing.ts
    symbol: doThing
    lines: "41-88"
```

Then:

```bash
npx tsx .cursor/companion/ideas.ts set <id> done --by idea-build --files src/thing.ts,tests/thing.test.ts --note "<what you built, in one line>"
```

`set` refuses `done` without `code` and `verify`, runs `verify.command` and
refuses if it fails, and refuses a manual check with no signature. That
refusal is the feature — do not pass `--force` unless the human asked.

## Step 6 — Loop

Back to Step 0. The frontier will have moved. Stop when it is empty, when
something is blocked, or when the human says so.

Finally: `render`, and report what got built, what is now ready, and what is
blocked and why.
