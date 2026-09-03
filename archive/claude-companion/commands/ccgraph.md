---
description: "Show the idea graph — render it, check it, and say what is ready to work on."
---

Read `claude-companion/FORMAT.md` if you need the node format.

## Arguments

$ARGUMENTS

An idea id shows just that idea. `--check` reports problems without rendering.
No arguments = check, render, and summarise.

## Do this

```bash
npx tsx claude-companion/ideas.ts check
npx tsx claude-companion/ideas.ts render
npx tsx claude-companion/ideas.ts next
```

With an id, instead: `npx tsx claude-companion/ideas.ts show <id>`.

## Then report

1. **The picture** — path to `ideas/graph.html`. Say that the graph shows names
   only and every node is clickable.
2. **Where things stand** — counts by status, the endpoints, and how much of the
   graph reaches each endpoint.
3. **What is ready now** — the frontier, in the order you would take them.
4. **What is wrong** — everything `check` reported. Errors first. The ones that
   matter most, in order:
   - a `done` idea with no `code` or no `verify` — "done" is unsupported
   - a `code` path that no longer resolves — the record has drifted from reality
   - an idea no endpoint depends on — either dead work or a missing endpoint
   - unanswered `why_this_way` — the reasoning is already lost
5. **What to do next** — one sentence naming the command: `/ccthink` for
   unanswered questions, `/ccbuild` for a ready frontier, `/ccfix` for anything
   blocked, `/ccscan --refresh` when the code has moved well past the graph.

Do not fix anything here. `/ccgraph` looks; the other commands act.
