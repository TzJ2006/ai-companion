---
description: "DAG-driven execution engine for approved ECL plans. Reads the FN-layer dependency graph, topologically sorts, spawns subagents in parallel for independent nodes, runs verification, writes status back to the ECL, and routes failures to /ccdebug."
---

Read the full skill specification at `skills/ccedit/SKILL.md`, then execute the /ccedit workflow.

## Arguments

$ARGUMENTS

If no arguments provided, execute the next batch of ready nodes from the most recent non-completed ECL in `docs/ecl/`.
If a path is provided, execute from that specific ECL file.
If `status` is provided, show execution state without acting.
If `reset <FN-ID>` is provided, transition a blocked FN back to `pending` for retry (after a /ccdebug fix).

## Execution

Follow the protocol in `skills/ccedit/SKILL.md` exactly, using the `@aidev/exec` CLI:

1. **Parse**: `npx tsx packages/exec/src/cli.ts parse <ecl-path>` — validate the FN DAG (node/edge/layer counts).
2. **State**: `npx tsx packages/exec/src/cli.ts state <ecl-path>` — list ready / pending / blocked / done nodes.
3. **Execute**: take up to `maxConcurrency` (`.devcompanion/exec.json`, default 3) ready nodes; serialize any that share the same `output.file`; spawn one subagent per node in parallel (single message, multiple Agent calls). Each subagent receives only its FN context — never the ECL path; subagents MUST NOT write ECL status.
4. **Verify + write back**: run each FN's verify via `npx tsx packages/exec/src/cli.ts verify <ecl-path> <FN-ID>`, then `npx tsx packages/exec/src/cli.ts set-status <ecl-path> <FN-ID> <done|blocked>`. On `blocked`, suggest `/ccdebug`.
5. **Loop** back to State until all `done` or all remaining `blocked`.

**Safety invariants:** only this orchestrator writes ECL status; writes are atomic; same-file outputs are never parallelized; no FN is `done` without its verify passing.
