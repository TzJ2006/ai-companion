# Codex Companion workflows

Read the common rules, then only the requested mode. The graph is the durable source of intent;
chat is not.

## Common rules

- Keep product behavior, node contracts, tests, and log evidence synchronized.
- Use `companion.py record --kind <kind> --summary <summary> [--node <id>] [--file <path>]` after
  meaningful changes. Describe both what changed and why in `--summary` or `--details`.
- Rendered HTML is a review surface, never the source of truth.
- If edits arrive from another agent, preserve them. One JSON file per node limits merge overlap.
- Do not alter another agent framework's files as a side effect of Codex Companion work.
- In strict mode, never simulate approval with CLI text or edit lifecycle/runtime state directly.
  `request-approval` creates a one-time challenge; only the user's exact Codex prompt consumes it.

## Onboard

1. Run `scan`. It inventories Git-tracked and unignored text files, records byte/line/hash values,
   and explicitly lists skipped binaries or unreadable files.
2. Read every included file in bounded batches, including documentation, configuration, tests,
   source, and comments. After fully reading unchanged content, run `reviewed <paths...>`.
3. Do not mark generated/vendor content reviewed without actually reading it. Explain any scope
   exclusion recorded by filesystem fallback.
4. Identify ideas from observable responsibilities and design decisions, not mechanically one node
   per function. Preserve evidence with local file and line references.
5. Create nodes and edges. For existing working code, verification may cite current tests, but run
   them before marking evidence passed.
6. Validate, render the name-only overview, and stop for the user to study and correct the graph.

## Discuss

Stay high-level. Inspect only enough project context to avoid asking questions already answered.
Then ask:

1. What are we making or changing?
2. What observable result means it succeeded?
3. Why is this worth doing now?

Restate the three answers with assumptions and explicit non-goals. Run
`request-approval --gate intent --node <id>` and stop with its exact challenge. The prompt hook sets
the node to `aligned` only if the user approves the unchanged snapshot.

## Plan

Planning has two separate review gates.

### Gate A: decomposition

1. Split the aligned idea into the smallest independently understandable outcomes. A node should
   have one main expected result and one coherent verification boundary.
2. Add prerequisite edges. Reject cycles and avoid arbitrary sequencing edges.
3. Render the graph with names only and explain boundary choices, assumptions, and open questions.
4. Run `request-approval --gate decomposition --node <id>` once for every node in the graph, then
   stop. Do not research detailed implementations before this unchanged graph is accepted.

### Gate B: researched plan

For every accepted node:

1. Search the repository for compatible code, tests, types, packages, conventions, and previous
   attempts. Record exact paths/symbols in `local_findings`.
2. Search the web for maintained implementations, standards, and known pitfalls. Prefer official
   documentation and primary repositories. Record source URLs and the specific applicable finding.
3. Decide reuse first: adopt, adapt, or reject. A rejection needs a concrete incompatibility or
   cost; “easier to build” is insufficient.
4. Design verification before implementation: input, operation, output, failure condition,
   measurable threshold, exact `test_paths`, and a shell-free command/argv. It may remain
   unimplemented at this gate.
5. Fill `how`, `why_this_way`, approved product `target_paths`, `future_use`, inputs/outputs, and an
   outcome-based weekly plan. Weeks are planning units, not promises about calendar duration.
6. Set the node to `planned`, validate, render all details, and stop for explicit plan approval.
7. Run `request-approval --gate plan --node <id>` for each independently reviewable plan. Its user
   response moves the unchanged node to `approved`; direct `set-status approved` is rejected.

## Build

1. Run `status`; select only an `approved` node whose prerequisites are `done`.
2. Run `activate <id>` and then `set-status <id> implementing`.
3. Implement files under `verification[].test_paths` first. Run
   `run-check <id> <check> --phase red`; strict mode blocks product writes until every automated
   check has current failure evidence. If a sound test unexpectedly passes, request a
   `red-waiver` for that node/check and stop for user review.
4. Implement the smallest planned change under `implementation.target_paths`. The pre-write hook
   rejects other paths. Change the plan and request approval again if scope must expand.
5. Run `run-check <id> <check> --phase green` plus proportionate regressions. A later tracked write
   makes green evidence stale and requires another green run.
6. Update inputs, outputs, verification evidence/status, and exact post-formatting code line ranges.
7. Use `request-approval --gate manual-check --node <id> --check <check>` for manual acceptance.
   Record semantic code, document, dependency, and idea changes with `record --node <id>`.
8. Set `done` only when the runtime accepts current evidence. Otherwise set `blocked` and enter
   Debug. Validate and render after the status change.
9. Deactivate the done node only after that fresh render, then move to the next topological node.

## Debug

First decide whether code drifted or the contract is wrong.

1. Read the node's eight sections, inputs/outputs, verification, and exact code references.
2. Compare each claim with current implementation and tests.
3. If inconsistent, produce a complete discrepancy list with tight `path:start-end` references,
   expected contract text, actual behavior, and proposed correction. Stop for user review before
   editing. After approval, correct the implementation and rerun verification.
4. If implementation matches the node, do not patch code speculatively. Show actual inputs, actual
   outputs, expected result, implementation reasoning, and verification limitations. Ask the user to
   revise the idea contract. Return to Discuss/Plan after confirmation.
5. Record the diagnosis even if no code changes.

## Graph

Run `validate`, then `render`. The overview contains idea names only; clicking a node opens all eight
sections plus prerequisites and dependents. Report validation failures instead of generating a
misleading graph.

## Record

The append-only log in the active `.codex-companion/` or `.codex-companion.codex/` state contains
machine-readable events. The hook captures
touched files for supported edit tools and increments the active node's change sequence. Semantic
records must additionally capture:

- idea and status changes;
- code, test, document, and dependency changes;
- reason and affected node;
- verification command/result or manual evidence;
- debug discrepancies and user decisions.

Never rewrite previous log events to make history look successful.
