---
name: ccedit
description: "DAG-driven execution engine for approved ECL plans"
---

# /ccedit — Execute ECL Plan

Execute an approved ECL document by driving its FN-layer DAG to completion.

## Usage

```
/ccedit              — Execute next batch from most recent non-completed ECL
/ccedit <path>       — Execute from specific ECL file
/ccedit status       — Show execution state without acting
/ccedit reset <ID>   — Unblock a failed FN for retry
```

## How It Works

1. Reads the FN DAG from an approved ECL document
2. Topologically sorts nodes, identifies ready batch (parallel-safe)
3. Spawns subagents to implement each FN
4. Runs verification (vitest) after each
5. Updates ECL status: done or blocked
6. Loops until all done or all blocked

## Integration

```
/ccplan → approved ECL → /ccedit → implements → /ccdebug (on failure)
```

## Prerequisites

- ECL file with `functions` section containing DAG fields
- Each FN must have: `id`, `depends_on`, `output`, `verify`, `status`
