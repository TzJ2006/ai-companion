---
name: slurm-gpu
description: >
  Detect available GPUs on a Slurm cluster, show which partitions they belong to,
  and report idle/allocated/down state. Trigger on: "what GPUs are available",
  "check slurm GPUs", "show GPU partitions", "which GPUs are free", or the
  /slurm-gpu command.
  Do NOT trigger when the user asks about local GPU benchmarking (use benchmark).
origin: custom
---

# Slurm GPU Detector

Query a Slurm cluster to discover GPU resources: what GPU types exist, which
partitions they belong to, and their current availability (idle / allocated / down).

## Slash Command

```
/slurm-gpu              # Full GPU inventory + availability summary
/slurm-gpu --free       # Only show idle/available GPUs
/slurm-gpu --partition <name>  # Filter by specific partition
```

## Execution Steps

### 1. Gather Raw Data

Run the following Slurm commands (all read-only, no elevated privileges needed):

```bash
# Node-level GPU info with partition and state
sinfo -N -o "%N %P %G %T %C" --noheader

# GRES (generic resource) summary per partition
sinfo -o "%P %G %a %D %T" --noheader

# Per-node GPU allocation detail (optional, may need sacctmgr access)
squeue -o "%i %j %u %P %N %b %T" --noheader 2>/dev/null
```

**Key fields:**
- `%N` — node name
- `%P` — partition name (trailing `*` = default)
- `%G` — GRES (e.g., `gpu:a100:4`, `gpu:v100:2`)
- `%T` — node state (`idle`, `alloc`, `mix`, `down`, `drain`, etc.)
- `%C` — CPUs: allocated/idle/other/total
- `%b` — GRES allocated by job

### 2. Parse GPU Information

From `sinfo` output, extract per-node:

| Field | Source | Example |
|-------|--------|---------|
| Node | `%N` | `gpu-node-01` |
| Partition | `%P` | `gpu_a100` |
| GPU Type | parse `%G` after `gpu:` | `a100` |
| GPU Count | parse `%G` trailing number | `4` |
| Node State | `%T` | `idle`, `mix`, `alloc` |

**Parsing rules for GRES field (`%G`):**
- `gpu:a100:4` → type=`a100`, count=`4`
- `gpu:4` → type=`unknown`, count=`4`
- `gpu:tesla_v100-sxm2-32gb:2` → type=`tesla_v100-sxm2-32gb`, count=`2`
- `(null)` or empty → skip (no GPU on this node)

**Node state mapping:**
- `idle` → all GPUs free
- `alloc` → all GPUs in use
- `mix` → some GPUs free (need `squeue` to determine how many)
- `down`, `drain`, `drng` → unavailable

### 3. Calculate Availability

For nodes in `mix` state, cross-reference with `squeue` output to determine
how many GPUs are actually allocated vs free:

```
free_gpus = total_gpus - allocated_gpus_on_node
```

For `idle` nodes: `free_gpus = total_gpus`
For `alloc` nodes: `free_gpus = 0`

### 4. Output Format

Present results as a structured summary:

```
## GPU Cluster Overview

### By Partition

| Partition | GPU Type | Total | Free | Allocated | Down |
|-----------|----------|-------|------|-----------|------|
| gpu_a100  | A100     | 16    | 4    | 10        | 2    |
| gpu_v100  | V100     | 8     | 3    | 5         | 0    |
| general   | RTX 3090 | 12    | 0    | 12        | 0    |

### Node Detail

| Node        | Partition | GPU Type | Total | Free | State   |
|-------------|-----------|----------|-------|------|---------|
| gpu-node-01 | gpu_a100  | A100     | 4     | 2    | mix     |
| gpu-node-02 | gpu_a100  | A100     | 4     | 0    | alloc   |
| ...         |           |          |       |      |         |

### Quick Summary
- Total GPUs: 36
- Available now: 7 (19%)
- Best option: gpu_a100 partition — 4 free A100 GPUs
```

## Flags

### `--free`

Only show nodes/partitions with at least 1 free GPU. Hide fully allocated and
down nodes. Useful for quick "where can I submit?" checks.

### `--partition <name>`

Filter output to a single partition. Accepts partial match (e.g., `a100`
matches `gpu_a100`).

## Error Handling

| Condition | Action |
|-----------|--------|
| `sinfo` not found | Report "Slurm not installed or not in PATH" |
| No GPU GRES found | Report "No GPU resources configured in this cluster" |
| `squeue` fails | Skip per-job allocation detail; estimate from node state only |
| SSH needed | Suggest `ssh <cluster> /slurm-gpu` |
| Permission denied | Report which command failed and suggest contacting admin |

## Notes

- All commands are **read-only** — no jobs are submitted or modified.
- Works with any Slurm version that supports `sinfo` GRES output (Slurm 17.11+).
- GPU type names vary by cluster config (e.g., `a100` vs `nvidia_a100_80gb`).
  Display as-is from Slurm; do not normalize names.
- Nodes can appear in multiple partitions — count GPUs once per node but show
  all partition memberships.
