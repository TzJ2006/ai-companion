# Idea Graph v1

Codex Companion stores one canonical JSON file per idea at `nodes/<id>.json` inside the active
`.codex-companion/` or `.codex-companion.codex/` state. The filename equals `id`. IDs use lowercase letters, digits,
dots, underscores, and hyphens. A node stores only `depends_on`; the renderer derives dependents,
so an edge has one source of truth.

## Required node contract

Every file has these fields, including empty arrays during early discussion:

```json
{
  "schema_version": "idea-node/v1",
  "id": "stable-node-id",
  "name": "Human-readable idea name",
  "status": "draft",
  "what": "What the idea is",
  "why": "Why the idea exists",
  "expected_result": "What a user or system can observe when it works",
  "implementation": {
    "how": "Detailed implementation design",
    "why_this_way": "Tradeoffs and reasons for this design",
    "target_paths": ["src/example.py"],
    "research": {
      "local_findings": ["Existing code or pattern and exact location"],
      "external_findings": ["Primary source URL plus relevant finding"],
      "reuse_decision": "What will be reused, or why reuse was rejected"
    },
    "weekly_plan": [
      {"week": 1, "outcome": "Reviewable outcome, not a list of activity"}
    ]
  },
  "code_refs": [
    {
      "path": "src/example.py",
      "start_line": 10,
      "end_line": 24,
      "symbol": "Example.run",
      "role": "How this range implements the idea"
    }
  ],
  "verification": [
    {
      "id": "observable-behavior",
      "kind": "automated",
      "plan": "Given/when/then behavior and acceptance threshold",
      "command": ["python", "-m", "unittest", "tests.test_example"],
      "test_paths": ["tests/test_example.py"],
      "status": "pending",
      "evidence": []
    }
  ],
  "future_use": "How later nodes, users, or systems can use the result",
  "depends_on": [],
  "inputs": ["Named input and constraints"],
  "outputs": ["Named output and guarantees"],
  "created_at": "2026-01-01T00:00:00+00:00",
  "updated_at": "2026-01-01T00:00:00+00:00"
}
```

The eight user-facing sections are `what`, `why`, `expected_result`, `implementation.how`,
`implementation.why_this_way`, `code_refs`, `verification`, and `future_use`. Inputs and outputs
are additional debugging aids, not replacements for those sections.

## Lifecycle gates

`draft → aligned → planned → approved → implementing → done`

- `aligned`: `what`, `why`, and `expected_result` are confirmed by a current intent receipt.
- `planned`: implementation design/reasoning, reuse decision, weekly outcomes, verification plan,
  and future use are recorded. The graph decomposition was reviewed first.
- `approved`: a one-time user prompt approved the full-plan snapshot. The agent never infers it.
- `implementing`: every prerequisite is `done`. Activate the node before editing product files.
- `done`: code references are exact; automated green evidence matches the latest tracked change and
  current test hashes; manual items passed; and the semantic record is current.
- `blocked`: current implementation cannot proceed; describe the evidence in the log.
- `superseded`: another node or decision replaced this idea; record the replacement.

Use `companion.py set-status` rather than editing status directly. Strict mode rejects direct
transitions to `aligned` and `approved`. Use `request-approval --gate intent|decomposition|plan`
and show the generated challenge to the user. The prompt hook records the user's actual response,
session metadata, and reviewed-content digest; changed content invalidates the receipt.

## Enforcement state

The node contract is durable intent. Mutable execution evidence lives separately under the active
state's `runtime/`, and approval requests/receipts live under `pending/` and `approvals/`.
Do not edit these files. The CLI tracks a `change_seq`, the last semantically recorded sequence,
red/green outcomes, test-file hashes, and the graph digest used for the latest render.

`implementation.target_paths` and every automated check's `test_paths` are project-relative paths
or glob patterns. Keep them narrow. Tests may be patched before red evidence; product paths require
current red evidence or an explicit user waiver. Anything outside both scopes requires plan edits
and a new approval.

## Code references

Use project-relative paths and inclusive, one-based line numbers. Refresh them after formatting or
other line movement. Refer to the smallest meaningful symbol or range. Do not put planned locations
in `code_refs`; record them in `implementation.how` until code exists.

## Verification evidence

Write the verification design before implementation. A useful plan identifies input, operation,
observable output, failure condition, acceptance threshold, test files, and an argv-safe command.
Use `run-check --phase red|green`; it writes check status/evidence and runtime hashes. Use a
`manual-check` approval challenge for human observation. Keep failed evidence in the audit log.
