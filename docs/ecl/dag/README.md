# Repo → DAG

A repeatable way to turn a repo that is "just a pile of files" into two things you
can actually re-enter cold:

1. **A readable dependency graph (DAG)** — milestones and the from-scratch tasks
   under them, with edges = prerequisites, running from zero to each **endpoint**
   (the repo's terminal deliverable).
2. **A "where I left off / why I wrote this" document** — every node carries a
   `status` (so you see what's done and what's next) and the **5 questions** (so
   you recover *why* each piece exists).

This folder holds one such DAG per repo. **Start with the index at the bottom.**

## The 5 questions (per node)

Every node — milestone or task — is documented with the AI-companion 5 questions
(canonical wording in `skills/ccdiscuss/SKILL.md`). This is the record of "why I
was writing all these functions."

| # | 中文 | Field | Captures |
|---|------|-------|----------|
| 1 | 是什么 | `what` | What this node is / does |
| 2 | 为什么做 | `why` | The problem it solves; why it must exist |
| 3 | 如何做 | `how` | Approach + key files / functions |
| 4 | 为什么这样做 | `why_this_way` | Rationale for *this* design over alternatives |
| 5 | 期望结果 | `expected` | The observable result that means it's done |

## The recipe (run this on any repo)

No special tooling required — it reuses what the companion already produces.

1. **Scan & understand.** Run the onboarding pipeline
   (`npx tsx scripts/run-onboarding.ts <repo>`) — it AST-scans the code and emits
   per-function `why / what / how` into `<repo>/.devcompanion/analysis.json` plus a
   feature-level ECL at `<repo>/docs/ecl/<repo>-features.yaml`. (If that already
   exists, reuse it.)
2. **Name the milestones.** A milestone is a chunk that produces something you'd
   ship or demo. The onboarding `features:` are the seed; group/rename them into
   `FEAT-*` nodes. These are the **coarse** layer.
3. **Decompose into tasks.** For each milestone, list the from-scratch steps that
   must happen to reach it as `FN-*` nodes (`parent:` the milestone). These are the
   **fine** layer — "what do I actually do next."
4. **Draw the edges.** `depends_on`: each node points to every node that must
   finish before it can start. Keep the graph **acyclic**.
5. **Mark where you left off.** Give every node a `status`
   (`done | in-progress | pending | blocked`). The **frontier** = pending nodes
   whose deps are all done — that is literally your next-actions list.
6. **Answer the 5 questions** for every node. `analysis.json` already gives
   `why / what / how`; you fill `why_this_way` and `expected` from intent + docs.
7. **Render.** Write the DAG to `<repo>.ecl.yaml` and a human view to `<repo>.md`:
   - a **Mermaid `flowchart TD`** with one `subgraph` per feature/layer, nodes
     labelled `ID\nshort description`, `classDef` colors by status
     (done / pending / blocked / terminal), and an edge block that mirrors the
     YAML `dependency_graph` exactly;
   - **clickable nodes** — a `click <NODE> "#anchor"` line per node pointing at
     that node's 5-question record lower in the same file (each record gets an
     explicit `<a id="anchor"></a>`). Mermaid node-clicks work in VS Code preview /
     Mermaid Live / Obsidian; GitHub disables them, so also add a plain-markdown
     **node index** of the same anchor links as a fallback;
   - the **5-question record** for every node, plus a "Where you left off → next
     actions" table driven by the pending frontier.

## How to read a DAG file

- `endpoints:` — the terminal deliverables. Everything exists to reach these.
- `milestones:` (FEAT) — read these top-to-bottom for the repo at a glance.
- `tasks:` (FN) — zoom in here when you want to know the exact next step.
- `dependency_graph:` — the edges. Follow them backward from an endpoint to see
  the full from-scratch path.
- `left_off:` — `done` / `in_progress` / `frontier_next` (do these now) /
  `blocked_until`.

The `.md` companion renders the same graph as Mermaid: **endpoints are
highlighted**, nodes are colored by status, so "where am I" is visible at a glance.

## Conventions

- IDs: `FEAT-<repo>-NN` (milestone), `FN-<repo>-NNNN` (task). `<repo>` is a short
  slug (`aic`, `code`, `data`, `paper`). IDs are never reused.
- `status` is the source of truth for "where I left off." Update it as you work.
- Edges are `depends_on` (prerequisites); the graph must stay acyclic.
- The `.ecl.yaml` follows the companion ECL vocabulary
  (`skills/ccplan/ecl-schema.md`) closely enough to stay legible to the pipeline;
  the task (`FN`) layer mirrors the `depends_on` shape that `packages/exec`
  (`parseEclDag` / `topologicalSort`) understands.

## Index

| Repo | DAG | Endpoint(s) | State |
|------|-----|-------------|-------|
| `ai-companion` (this repo) | [`ai-companion.ecl.yaml`](ai-companion.ecl.yaml) · [`ai-companion.md`](ai-companion.md) | operational skills pipeline · dashboard · installable | built (template) |
| `ErrorRecoveryBenchmark` | _phase 2_ | reproducible code release + eval protocol | planned |
| `ErrorRecoveryBenchData` | _phase 2_ | clean dataset release (v1.0.1) | planned |
| `NIPS_2026_Error_Recovery` | _phase 2_ | NeurIPS 2026 submission | planned |

> ai-companion is the worked example / template. Once its format is confirmed, the
> three Error Recovery Benchmark repos get the same treatment, plus a cross-repo
> `overview.md` linking them (`code → data → paper → release`).
