---
description: >-
  Launch hypothesis-driven debugging — structured bug triage, parallel
  hypothesis investigation, iterative fix-and-validate cycles. Use this
  instead of ad-hoc debugging when the root cause is unknown.
---

# /cchypothesis — Hypothesis-Driven Debugging

This command invokes the **cchypothesis** skill to debug issues using
the scientific method: observe, hypothesize, verify, fix, validate, iterate.

## Usage

```
/cchypothesis "API returns 500 on POST /users with long names"
/cchypothesis "Tests pass locally but fail in CI intermittently"
/cchypothesis "Memory grows unbounded after 24h"
/cchypothesis --multi "Login broken AND dashboard shows stale data"
```

### Flags

| Flag | Description |
|------|-------------|
| (default) | Single bug debugging |
| `--multi` | Explicitly indicate multiple bugs in one report |
| `--no-doc` | Skip diagnostic document generation on success |
| `--full-suite` | Run full test suite in validation (default: module-level only) |
| `--human-confirm` | Require user confirmation after fix (auto-enabled for UI/visual bugs) |

## What Happens

1. **Bug Triage** — Understands your bug report, gathers context from the codebase (files, logs, git history), decomposes multiple bugs if present, classifies causal relationships, attempts reproduction
2. **Hypothesis Generation** — Generates 3 falsifiable hypotheses about root cause, each with a verification plan and investigation type (static or instrumented)
3. **Hypothesis Investigation** — Smart dual-track approach:
   - **Git safety checkpoint** — Protects your uncommitted work before any investigation
   - **Static analysis** — Parallel read-only subagents for code-structure hypotheses
   - **Instrumented probing** — For runtime-dependent hypotheses: inserts `[DEBUG Hx]` tagged logs at suspected locations, runs reproduction, analyzes output, then cleans up with `git restore`
4. **Fix & Validate** — For confirmed hypotheses: applies minimal fix, runs three-tier test validation (specific test -> module tests -> full suite). For UI/visual bugs: optional human confirmation
5. **Loop Control** — If not resolved: generates next batch of 3 hypotheses informed by prior findings. Max 3 rounds (9 hypotheses total)
6. **Diagnostic Report** — Writes structured document to `docs/debug/` recording all hypotheses, instrumentation logs, evidence, and outcomes

## Conversation Flow

This skill runs continuously across multiple turns. It will only pause to ask
you questions when:
- The bug report lacks critical information (max 3 clarification questions)
- The bug cannot be reproduced and needs your help
- All rounds are complete (final report)

If the conversation loses context, just describe the bug again — the skill
picks up from the diagnostic doc if one exists.

## Output

### During debugging

A running hypothesis table is maintained and shown at phase transitions:

```
| # | Hypothesis | Method | Confidence | Verdict | Key Evidence |
|---|-----------|--------|------------|---------|--------------|
| H1 | Missing retry backoff | static | 0.7 | confirmed | No delay at client.py:142 |
| H2 | Wrong timeout config | static | 0.5 | rejected | Timeout=30s is correct |
| H3 | Stale cache TTL | instrumented | 0.8 | confirmed | [DEBUG H3] expires_at==now→False |
```

### After debugging

- **Bug resolved**: Fix applied + optional diagnostic doc at `docs/debug/<slug>_<timestamp>.md`
- **Bug unresolved (9 hypotheses exhausted)**: Detailed diagnostic doc with all evidence, instrumentation logs, narrowed scope, and recommended next steps

## Tips

- **Be specific**: "POST /users returns 500 when name > 100 chars" is better than "API is broken"
- **Include reproduction**: If you have steps to trigger the bug, include them
- **Mention recent changes**: "This started after commit abc123" dramatically narrows the search
- **Trust the process**: Even failed hypotheses are valuable — they eliminate possibilities and narrow the search space
