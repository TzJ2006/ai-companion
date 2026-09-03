# Change log

## Unreleased

- Added sticky agent suffixes for occupied state namespaces and explicit report outputs, so Codex,
  Claude, and Cursor companion artifacts can coexist without overwriting one another.

## 0.2.0 — 2026-08-24

- Replaced agent-authored approval text with one-time challenges consumed only from exact user
  prompts; receipts are bound to the reviewed graph or plan digest.
- Added blocking pre-write scope enforcement for managed state, test paths, product target paths,
  and common shell mutation routes.
- Added executable red/green check evidence with test hashes and active-node change sequences.
- Made `done` require current green/manual evidence, exact references, and a current semantic log.
- Added Stop enforcement for unfinished active nodes and fresh-render/deactivation handoff.
- Expanded adversarial tests for stale approvals, protected state, test-first writes, stale evidence,
  semantic records, and review-boundary stops.

## 0.1.0 — 2026-08-24

This is a clean Codex-specific implementation. It does not modify or import the concurrent Claude
Code, Cursor, ECL, or `cc*` implementations in the parent repository.

- Added `.codex-plugin/plugin.json` and one progressively disclosed `codex-companion` skill.
- Defined `idea-graph/v1` and `idea-node/v1` as per-node JSON contracts with eight required idea
  sections, prerequisites, inputs/outputs, research, weekly outcomes, lifecycle, and evidence.
- Added explicit review gates for intent alignment, graph decomposition, and full-plan approval.
- Added a zero-dependency CLI for project initialization, nodes, DAG/schema/readiness validation,
  ordered state transitions, active-node tracking, onboarding coverage, audit events, topological
  status, and self-contained HTML rendering.
- Added done-state enforcement for passed verification evidence and valid project-relative code line
  ranges.
- Added a non-blocking plugin hook that records touched files for Codex edit tools without blocking
  the edit when recording is unavailable.
- Added seven unit tests covering cycles, lifecycle approval, prerequisite readiness, verification,
  code-reference bounds, onboarding coverage, hooks, and HTML content.
- Added a three-node demo and generated clickable HTML report for visual review.
