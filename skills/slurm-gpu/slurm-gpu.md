---
name: slurm-gpu
description: >
  Slash command for checking Slurm GPU availability and partition mapping.
trigger: /slurm-gpu
---

# /slurm-gpu

Check available GPUs on a Slurm cluster and their partition assignments.

## Usage

```
/slurm-gpu                        # Full GPU inventory
/slurm-gpu --free                 # Only show free GPUs
/slurm-gpu --partition gpu_a100   # Filter by partition
```

## Behavior

### 1. Detect Slurm Environment

Verify `sinfo` is available. If not, report and stop.

```bash
command -v sinfo >/dev/null 2>&1
```

### 2. Query GPU Resources

Run these commands and capture output:

```bash
# Primary: node-level GPU and state info
sinfo -N -o "%N %P %G %T %C" --noheader

# Secondary: job-level GPU allocation (for mix-state accuracy)
squeue -o "%i %j %u %P %N %b %T" --noheader 2>/dev/null
```

### 3. Parse and Aggregate

For each line from `sinfo`:
1. Split into node, partition, gres, state, cpus
2. Skip lines where gres is `(null)` or does not contain `gpu:`
3. Parse gres: `gpu:<type>:<count>` or `gpu:<count>`
4. Determine free GPUs based on state:
   - `idle` → free = total
   - `alloc` → free = 0
   - `mix` → free = total - (GPUs allocated on that node from `squeue`)
   - `down|drain|drng` → free = 0, mark as down

### 4. Apply Filters

- `--free`: Drop entries where free = 0
- `--partition <name>`: Keep only entries where partition contains `<name>` (case-insensitive)

### 5. Format Output

Present two tables:
1. **By Partition** — aggregated totals per partition+GPU type
2. **Node Detail** — per-node breakdown (skip if >50 nodes unless filtered)

End with a **Quick Summary**: total GPUs, free count, percentage, best partition recommendation.

## Example Output

```
## GPU Cluster Overview

### By Partition

| Partition | GPU Type | Total | Free | Allocated | Down |
|-----------|----------|-------|------|-----------|------|
| gpu_a100  | a100     | 16    | 4    | 10        | 2    |
| gpu_v100  | v100     | 8     | 3    | 5         | 0    |

### Quick Summary
- Total GPUs: 24
- Available now: 7 (29%)
- Best option: gpu_a100 — 4 free a100 GPUs
```
