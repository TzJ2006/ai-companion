---
description: >-
  Launch Evolving Constraint Planning — diverge-then-converge requirement
  engineering with adversarial validation and feasibility probing. Use this
  instead of /plan when requirements are ambiguous, conflicting, or complex.
  WAIT for user confirmation at Phase 9 before any implementation.
---

# /ccplan — Evolving Constraint Planning

This command invokes the **ccplan** skill to transform
raw requirements into a validated, constraint-bound implementation plan.

## Usage

```
/ccplan "Add real-time collaborative editing"
/ccplan "Migrate from REST to GraphQL"
/ccplan --resume  # Resume from existing ECL document in docs/ecl/
/ccplan --guard                     # Show all active feature guards
/ccplan --guard src/auth/           # Check guards for specific path
/ccplan --guard --verify            # Run all guard verification commands
```

## What Happens

0. **Prompt Calibration** — Extracts intent, detects anti-patterns, enriches with project context
1. **Context Scan** — Reads project state, existing ECL documents
2. **Hypothesis Interrogation** — Challenges your requirements one question at a time
3. **Divergent Exploration** — Generates 5-10+ approaches to fill blind spots
4. **Requirement Crystallization** — Decomposes into atomic, testable items
5. **Adversarial Filtering** — Subagent attacks requirements for conflicts
6. **Dependency Completion** — Fills gaps in the requirement chain
7. **Feasibility Probing** — Generates spike code for uncertain items
8. **Red-Blue Confrontation** — Two subagents: attacker vs defender
9. **Review Gate** — Presents complete plan. **WAITS for your approval.**
10. **Implementation** — TDD from ECL constraints
11. **Feedback Loop** — Issues re-enter the appropriate phase

After implementation (Phase 10), **Feature Guards** are auto-generated to protect
implemented features from accidental regression in future sessions. Guards persist
in the ECL document and activate automatically when any agent edits a guarded file.

## Conversation Flow

This skill runs across multiple turns. When it asks you a question (via the structured input prompt), just answer — the workflow continues automatically.

If the conversation loses track (e.g., after context compaction), say "continue" or use `/ccplan --resume` to pick up from the ECL document.

## Output

An ECL (Evolving Constraint Language) document at `docs/ecl/<feature>.yaml`
that any agent can read cold to continue the work.

## When to Use /ccplan vs /plan

| Situation | Use |
|-----------|-----|
| Clear requirements, single feature | `/plan` |
| Ambiguous requirements, multiple approaches | `/ccplan` |
| Multi-session project needing persistence | `/ccplan` |
| Quick bug fix or known issue | Neither — just fix it |
| Requirements might conflict or be wrong | `/ccplan` |
| Protecting features during bug fixes | `/ccplan --guard` (no full plan needed) |

## Related Commands

After `/ccplan` approval:
- `/tdd` — Implement with test-driven development
- `/verify` — Run verification loop
- `/code-review` — Review completed implementation
- `/ccplan --guard` — Check feature guards before editing protected files
