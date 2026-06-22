# Recovery Benchmark — Repo → DAG

This folder is the **DAG-ified view** of the Error Recovery Benchmark project. It
takes three raw repos (piles of files) and re-presents each as a readable
dependency graph plus a "where I left off / why I wrote this" document, so you can
re-enter any repo cold and know exactly what is done, what is next, and why each
piece exists.

> **You are here.** If you only read one file, read [`overview.md`](overview.md) —
> it links all three repos and tells you the single next action on each critical path.

## The repos (the raw input)

| Repo | Role | Endpoint (what "done" means for it) |
|------|------|--------------------------------------|
| `ErrorRecoveryBenchmark` | the **code** (5-stage pipeline) | reproducible **code release** + eval **protocol/leaderboard** |
| `ErrorRecoveryBenchData` | the **data** (scenes + demos) | clean public **dataset release** (v1.0.1) |
| `NIPS_2026_Error_Recovery` | the **paper** (RecoverBench) | complete, consistent **NeurIPS 2026 submission** |

Each repo has its **own endpoint**. They also chain: **code → data → paper →
release** (see `overview.md`).

## The mechanism — how a raw repo becomes a DAG

This is the reusable recipe. Run it on any repo to produce the two artifacts below.

1. **Scan & understand** the repo (AST + docs + git) → what components exist.
2. **Name the milestones** — the deliverables. A milestone is a chunk of work
   that produces something you'd ship or demo. These are the *coarse* nodes.
3. **Decompose each milestone into tasks** — the from-scratch steps that must
   happen to reach it. These are the *fine* nodes. A task is one node in the
   executable graph (one file/symbol, one verifiable outcome).
4. **Draw the edges** — `depends_on`: a node points to every node that must be
   finished before it can start. This produces the DAG (no cycles).
5. **Mark where you left off** — every node gets a `status`
   (`done | in-progress | pending | blocked`). The frontier (pending nodes whose
   deps are all `done`) is literally "what to do next."
6. **Answer the 5 questions** for every node (below) — this is the documentation
   of *why* the function/feature exists, recoverable cold.

## The two levels

- **Milestone level** (`FEAT-*`) — the deliverables and the big intermediate
  results. Read this to understand the repo at a glance.
- **Task level** (`FN-*`) — the concrete from-scratch steps under each milestone.
  Read this to know exactly what to build next.

`overview.md` shows milestone level across all repos; each `*.md` zooms into the
task level for one repo.

## The 5 questions (per node)

Every node — milestone or task — is documented with the AI-companion 5 questions.
This is the "why I was writing all these functions" record.

| # | Question (中文) | Field | What it captures |
|---|------|-------|------|
| 1 | 是什么 | `what` | What this node is / does |
| 2 | 为什么做 | `why` | The problem it solves; why it must exist |
| 3 | 如何做 | `how` | Approach + key files/functions that implement it |
| 4 | 为什么这样做 | `why_this_way` | Rationale for *this* design over alternatives |
| 5 | 期望结果 | `expected` | The observable result that means it's done (the acceptance criteria) |

## Files in this folder

| File | Level | Contents |
|------|-------|----------|
| `overview.md` | milestone (all 3 repos) | Cross-repo Mermaid, endpoints, where-you-left-off, next actions |
| `benchmark-code.ecl.yaml` | milestone + task | Executable ECL DAG for `ErrorRecoveryBenchmark` |
| `benchmark-code.md` | milestone + task | Mermaid + readable 5-question docs + status for the code repo |
| `bench-data.ecl.yaml` / `.md` | milestone + task | Same, for `ErrorRecoveryBenchData` |
| `paper.ecl.yaml` / `.md` | milestone + task | Same, for `NIPS_2026_Error_Recovery` |

## Conventions

- IDs: `FEAT-<repo>-NN` (milestone), `FN-<repo>-NN` (task). `<repo>` ∈
  `{code, data, paper}`. IDs are never reused.
- `status` is the source of truth for "where I left off." Update it as you work;
  the Mermaid re-renders the frontier.
- Edges are `depends_on` (prerequisites). The graph must stay acyclic.
- The `.ecl.yaml` files follow the companion ECL schema
  (`skills/ccplan/ecl-schema.md`) closely enough to be read by the pipeline; the
  `.md` files are the human-readable rendering.
