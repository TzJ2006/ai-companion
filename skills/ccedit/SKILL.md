---
name: ccedit
description: >-
  DAG-driven execution engine for approved ECL documents. Reads the FN-layer
  dependency graph from an ECL file, performs topological sort, spawns subagents
  in parallel for independent nodes, runs verification commands, writes status
  back to ECL, and routes failures to /ccdebug. Resumes from where it left off
  across sessions.
  TRIGGER when: user says "ccedit", "execute the plan", "start implementing",
  "implement the ECL", or invokes /ccedit.
  DO NOT TRIGGER when: user wants to plan (use /ccplan), debug (use /ccdebug),
  or onboard (use /cconboard).
origin: custom
---

# /ccedit — DAG Execution Engine

## Core Premise

> **Plans are worthless without execution. Execution without plans is chaos.**
> ccedit bridges the gap: it takes an approved ECL document and mechanically
> drives implementation through its FN-layer DAG, one atomic task at a time.

## When to Use

- After /ccplan produces an approved ECL with FN DAG (Phase 9 approved)
- When resuming implementation of a partially-completed ECL
- When unblocking a node after /ccdebug fixes an issue (`/ccedit reset <FN-ID>`)

**Do NOT use** for planning (use /ccplan), debugging (use /ccdebug), or when
no ECL with FN DAG exists.

## Prerequisites

An ECL document at `docs/ecl/<feature>.yaml` must contain:
- `status` field indicating Phase 9 approved or later
- `functions` section with FN nodes having: `id`, `depends_on`, `output`, `verify`, `status`

## Execution Protocol

### Step 1: Load and Parse

1. Locate the target ECL file (user specifies, or find the most recent non-completed one)
2. Run: `npx tsx packages/exec/src/cli.ts parse <ecl-path>`
   - Validates all FN fields
   - Reports any missing/invalid fields
   - Returns node count and edge count

### Step 2: Analyze Execution State

1. Run: `npx tsx packages/exec/src/cli.ts state <ecl-path>`
   - Returns: ready nodes, blocked nodes, done nodes, pending nodes
2. If all done → announce completion, exit
3. If blocked nodes exist → report them, suggest `/ccdebug` or `/ccedit reset`
4. If ready nodes exist → proceed to Step 3

### Step 3: Execute Ready Nodes

1. Load execution config (`.devcompanion/exec.json` → maxConcurrency, default 3)
2. Take up to `maxConcurrency` ready nodes
3. **Conflict check**: if two ready nodes share the same `output.file`, serialize them (never parallelize same-file writes)
4. For each node in the batch, spawn a subagent:

```
Agent({
  description: "Implement <FN-ID>: <fn.name>",
  prompt: <output of formatSubagentPrompt>,
})
```

5. Spawn independent subagents in parallel (single message, multiple Agent tool calls)

### Step 4: Verify and Update

After each subagent completes:

1. Run the FN's verification command:
   ```bash
   <fn.verify.command>
   ```
2. If exit 0:
   - Update ECL: set FN status to `done`
   - Check downstream nodes: if all their `depends_on` are now `done`, they become ready
3. If non-zero exit:
   - Update ECL: set FN status to `blocked`
   - Report failure output
   - Suggest: `/ccdebug --file <test-file>` to diagnose

### Step 5: Loop

Return to Step 2. Continue until:
- All FNs are `done` → announce completion
- All remaining FNs are `blocked` → report blockers, exit
- User interrupts

## Subcommands

### `/ccedit` (default)
Execute the next batch of ready nodes from the most recent non-completed ECL.

### `/ccedit <ecl-path>`
Execute from a specific ECL file.

### `/ccedit status`
Show current execution state without executing anything.

### `/ccedit reset <FN-ID>`
Transition a blocked FN back to pending for retry after /ccdebug fix.

## Subagent Context Assembly

Each subagent receives (via `buildSubagentContext` + `formatSubagentPrompt`):

**Included:**
- FN spec (description, input/output interface, constraints, test cases)
- Output location (file path, export symbol)
- Parent module's public interface
- Completed dependencies' output locations (for import)
- Verification command

**Excluded:**
- Other unrelated FNs
- Confrontation/probe history
- Full ECL document
- ECL file path (subagent must NOT write to ECL)

## Safety Invariants

1. **Only this orchestrator writes ECL status** — never subagents
2. **Writes are atomic** — temp file + rename, no partial writes
3. **Same-file conflict detection** — two FNs targeting the same output file are never parallelized
4. **Verification is mandatory** — no FN is marked done without passing its verify command
5. **Deterministic ordering** — lexicographic sort on FN IDs within each topological layer

## Session Recovery

On invocation, ccedit reads the ECL and categorizes all FN nodes:
- `done` → skip
- `blocked` → report, do not execute
- `pending` with all deps `done` → ready, execute next
- `pending` with deps not done → wait

No separate progress file. ECL is the single source of truth.

## Integration with Other Skills

```
/ccplan (planning) → produces approved ECL with FN DAG
     │
     ▼
/ccedit (execution) → implements FN by FN, marks done
     │
     ▼ (on failure)
/ccdebug (debugging) → fixes failing verification
     │
     ▼ (after fix)
/ccedit reset <FN-ID> → unblocks, continues execution
```

## Library Functions (packages/exec/)

| Function | Purpose |
|----------|---------|
| `parseEclDag(eclPath)` | Parse ECL → DagGraph |
| `validateFnFields(rawFn)` | Validate FN has required fields |
| `topologicalSort(graph)` | Kahn's algorithm → ExecutionLayer[] |
| `getReadyNodes(graph)` | Convenience: pending + all deps done |
| `getExecutionState(graph)` | Full categorization: ready/blocked/done/pending |
| `buildSubagentContext(fnId, graph, eclPath)` | Assemble subagent context |
| `formatSubagentPrompt(context)` | Context → prompt string |
| `updateFnStatus(eclPath, fnId, status)` | Atomic status writeback |
| `runVerification(config, timeout?)` | Run verify command |
| `loadExecConfig(projectRoot?)` | Load .devcompanion/exec.json |

## Configuration

File: `.devcompanion/exec.json`

```json
{
  "maxConcurrency": 3
}
```

If the file does not exist, defaults are used.
