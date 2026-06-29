---
name: cchypothesis
description: >-
  Hypothesis-driven debugging skill. Triages bugs, generates falsifiable
  hypotheses about root causes, verifies them with smart dual-track
  investigation (parallel static analysis + sequential instrumented probing
  with [DEBUG Hx] tagged logs and git restore cleanup), implements fixes,
  and validates with tests + optional human confirmation. Iterates in
  batches of 3 hypotheses (max 9 total). Produces diagnostic documents
  recording all attempts, instrumentation logs, and outcomes.
  TRIGGER when: user reports a bug, test failure, unexpected behavior, or
  asks for debugging help. Also triggers on: "debug this", "fix this bug",
  "why is this failing", "帮我debug", "这个bug怎么回事", "cchypothesis".
  DO NOT TRIGGER when: the fix is already known, the task is a feature
  request, or user says "just fix it" with a one-line obvious fix.
origin: custom
---

# cchypothesis — Hypothesis-Driven Debugging

Debug like a scientist: observe symptoms, form falsifiable hypotheses, design
experiments, verify or reject, iterate until the root cause is found.

## Core Philosophy

> **Every "I think the bug is here" is a hypothesis, not a fact.**
> Unverified intuition causes developers to spend hours chasing wrong leads.
> This skill forces structured hypothesis generation, parallel investigation,
> and evidence-based verdicts — eliminating confirmation bias and wasted cycles.

Three principles:
1. **Observe before guessing** — Gather context (logs, traces, git history) before generating any hypothesis.
2. **Falsify, don't confirm** — Design investigations that can DISPROVE a hypothesis, not just confirm it.
3. **Accumulate information** — Each failed hypothesis narrows the search space. Later batches build on earlier evidence.

## When to Use

- Bug reports where the root cause is unknown
- Test failures with non-obvious causes
- "It was working yesterday" regressions
- Complex bugs spanning multiple files or modules
- Intermittent / hard-to-reproduce issues

**Do NOT use** for:
- One-line typos or obvious fixes (just fix them directly)
- Feature requests or enhancements
- Build errors (use build-error-resolver instead)
- Performance optimization (use code-optimizer instead)

## Workflow Overview

```
User reports bug(s)
        |
        v
+-------------------------------+
|  Phase 1: BUG TRIAGE          |  Understand, gather context,
|  (问题分诊)                   |  decompose, classify causality,
|                               |  reproduce if possible
+---------------+---------------+
                |
                v
+-------------------------------+
|  Phase 2: HYPOTHESIS          |  Generate 3 hypotheses per batch,
|  GENERATION (假设生成)        |  each with verification plan +
|                               |  investigation type classification
+---------------+---------------+
                |
                v
+-------------------------------+
|  Phase 3: HYPOTHESIS          |  Step 0: Git Safety Checkpoint
|  INVESTIGATION (假设调查)     |  Step 1: Triage (static / instrumented)
|                               |  Step 2: Parallel static (READ-ONLY)
|  Smart dual-track:            |  Step 3: Sequential instrumented probing
|  static + instrumented        |    [DEBUG Hx] tags → run → analyze
|                               |    → git restore (per hypothesis)
|                               |  Step 4: Verdict synthesis
+---------------+---------------+
                |
                v
+-------------------------------+
|  Phase 4: FIX & VALIDATE      |  Apply fix (SERIAL), run
|  (修复验证)                   |  three-tier test validation
|                               |  + optional human confirmation
+---------------+---------------+
                |
                v
+-------------------------------+
|  Phase 5: LOOP CONTROL        |  resolved --> Phase 6
|  (循环控制)                   |  not resolved --> Phase 2
|                               |  9 hypotheses --> Phase 6
+---------------+---------------+
                |
                v
+-------------------------------+
|  Phase 6: DIAGNOSTIC REPORT   |  Write structured doc to
|  (诊断文档)                   |  docs/debug/<slug>_<ts>.md
|                               |  + instrumentation log
+-------------------------------+
```

## Phase Details

### Phase 1: Bug Triage (问题分诊)

The first phase transforms a raw bug report into actionable debugging targets.

#### Step 1: Problem Understanding

Parse the user's bug description and extract:
- **Symptoms**: What is the user observing? (error message, wrong behavior, crash)
- **Expected behavior**: What should happen instead?
- **Trigger conditions**: When does it happen? (always, intermittently, after specific action)
- **Environment**: OS, runtime version, relevant config

#### Step 2: Context Gathering (信息收集)

Before generating any hypothesis, gather project-grounded context:

1. **Error artifacts** — Search for stack traces, error logs, recent test output
2. **Code scan** — Grep/Glob for files related to the described symptom
3. **Git history** — Check recent commits touching affected areas (`git log --oneline -20 -- <affected_paths>`)
4. **Existing tests** — Find test files covering the affected functionality

This step prevents generating hypotheses that the codebase already answers.

#### Step 3: Multi-Bug Decomposition

If the report contains multiple distinct issues:

1. **Segment** — Split into individual bug descriptions
2. **Classify causal relationships** between each pair:
   - `independent` — No interaction; process separately
   - `symptom-of` — Bug A is caused by Bug B; fix B first, then check if A resolves
   - `shared-root` — Both bugs stem from the same cause; merge into one investigation track
3. **Prioritize** — `symptom-of` roots first > `shared-root` merged tracks > `independent` by severity

**Single-bug fast path:** If only one bug is described, skip decomposition entirely.

#### Step 4: Information Sufficiency Check

If fewer than 2 of the following are available: error message, reproduction steps, affected component — ask the user for clarification using `AskUserQuestion` (max 3 questions).

**Hard rule:** Do not ask questions the codebase scan already answered.

#### Step 5: Reproduction Attempt

If a test command or reproduction step is available, attempt to reproduce:
- Run the failing test or command
- Record the output (this becomes baseline evidence for later validation)
- If reproduction fails, mark bug state as `not-reproducible` and ask user for more context

**Bug states after Phase 1:**
- `reproduced` — Ready for Phase 2
- `not-reproducible` — Need more info from user
- `insufficient-info` — Waiting for user clarification

**-> Proceed to Phase 2 for each `reproduced` bug.**

### Phase 2: Hypothesis Generation (假设生成)

Generate **3 hypotheses** per batch. Each hypothesis is a structured claim:

```yaml
hypothesis:
  id: H1  # H1-H9 across rounds
  round: 1  # 1, 2, or 3
  claim: "The timeout occurs because the retry loop has no backoff, causing rate limiting"
  confidence: 0.7  # 0.0-1.0, based on evidence strength
  investigation_type: static  # static | needs-instrumentation (see Phase 3 Step 1)
  verification_plan:
    steps:
      - "Search for retry logic in src/api/client.py"
      - "Check if backoff/delay exists between retries"
      - "Look for rate limit response handling"
    expected_if_true: "Retry loop with no delay between attempts"
    expected_if_false: "Backoff already implemented; timeout has different cause"
    instrumentation_points: []  # populated if investigation_type is needs-instrumentation
  affected_files:
    - "src/api/client.py"
    - "src/api/config.py"
```

#### Generation Rules

1. **Round 1**: Generate from symptom analysis + code scan. Cast a wide net across plausible causes.
2. **Round 2**: Informed by Round 1 rejections. Narrow scope based on what was eliminated. Explore deeper or adjacent areas.
3. **Round 3**: Informed by Rounds 1-2. Consider unusual causes: race conditions, environment differences, dependency version mismatches, configuration drift.

#### Hypothesis Quality Checklist

Each hypothesis MUST be:
- **Falsifiable** — There is a concrete investigation that can disprove it
- **Specific** — Points to a specific code path, configuration, or interaction
- **Distinct** — Does not overlap significantly with other hypotheses in the same batch
- **Actionable** — The verification plan can be executed with available tools

If a hypothesis fails the checklist, replace it before proceeding.

### Phase 3: Hypothesis Investigation (假设调查)

Phase 3 uses a **smart dual-track** approach: static analysis for code-readable
hypotheses, instrumented probing for runtime-dependent ones.

#### Step 0: Git Safety Checkpoint

Before any investigation, protect the working tree:

1. Run `git status` to check for uncommitted changes
2. **If dirty AND bug is in committed code**: `git stash push -m "cchypothesis-pre-debug"` to
   save uncommitted work. Record `git_stashed: true`.
3. **If dirty AND bug is in uncommitted changes**: Do NOT stash — debug the current state.
   Record `git_stashed: false`.
4. **If clean**: Proceed. Record `git_stashed: false`.

**End-of-session cleanup:** If `git_stashed: true`, run `git stash pop` after
Phase 4 or Phase 6 completes to restore the user's original work.

#### Step 1: Investigation Triage

Classify each hypothesis's investigation method:

| Classification | Criteria | Method |
|---------------|----------|--------|
| `static` | Code structure, configuration, dependency, type errors — verifiable by reading code | Parallel read-only subagent |
| `needs-instrumentation` | Runtime state, timing, data flow, concurrency, environment-dependent — requires execution to verify | Sequential instrumented probing |

**Heuristics for `needs-instrumentation`:**
- Hypothesis involves variable values at runtime ("the counter overflows")
- Hypothesis involves execution order ("handler A runs before B")
- Hypothesis involves timing ("timeout fires too early")
- Hypothesis involves data transformation ("JSON parse drops the field")
- Hypothesis involves environment state ("env var is unset in CI")

Record the classification in each hypothesis's structure:
```yaml
hypothesis:
  id: H1
  investigation_type: static  # static | needs-instrumentation
  # ... rest of hypothesis fields
```

#### Step 2: Parallel Static Analysis

**This step is READ-ONLY.** No file modifications, no code edits.

Launch subagents in parallel for all `static` hypotheses. Each subagent receives:
- The hypothesis (claim + verification plan)
- Bug context from Phase 1 (symptoms, affected files, reproduction output)
- Accumulated evidence from prior rounds (if Round 2 or 3)

Each subagent:
1. Execute the verification plan steps (Read, Grep, Glob only)
2. Compare observed code/state against `expected_if_true` and `expected_if_false`
3. Return a structured verdict:

```yaml
verdict:
  hypothesis_id: H1
  result: confirmed  # confirmed | rejected | inconclusive
  confidence: 0.85
  evidence:
    - "Found retry loop at src/api/client.py:142-158 with no delay"
    - "No backoff import or sleep call in the module"
  files_examined:
    - "src/api/client.py"
    - "src/api/config.py"
  suggested_fix: "Add exponential backoff with jitter between retries"
  needs_write_test: true  # true if fix must be applied to confirm
```

**Auto-upgrade rule:** Any `static` hypothesis that returns `inconclusive` is
automatically reclassified as `needs-instrumentation` and queued for Step 3.

#### Step 3: Sequential Instrumented Probing

**This step modifies files temporarily.** Each hypothesis is probed one at a time
to avoid working tree conflicts.

For each `needs-instrumentation` hypothesis:

1. **Insert instrumentation** — Add tagged debug logs at hypothesis-relevant locations
   (see Instrumentation Protocol below). Max **5 instrumentation points** per hypothesis.

2. **Run reproduction** — Execute the reproduction command from Phase 1.
   Capture output:
   ```bash
   <reproduction_command> 2>&1 | tee .debug/hypothesis.log
   ```
   If tee is unavailable: `<reproduction_command> > .debug/hypothesis.log 2>&1`

3. **Analyze logs** — Extract hypothesis-specific output:
   ```bash
   grep "[DEBUG Hx]" .debug/hypothesis.log
   ```
   Map observed values against `expected_if_true` and `expected_if_false`.

4. **Record verdict** — Same verdict format as Step 2 (confirmed/rejected/inconclusive),
   but with `investigation_method: instrumented` and log evidence.

5. **Clean up instrumentation** — Remove all debug code and temporary files:
   ```bash
   git restore .
   rm -rf .debug/
   ```
   Verify cleanup: `git status` should show no changes.
   If `git restore` fails, fall back to `git checkout -- .`

6. **Repeat** for the next `needs-instrumentation` hypothesis.

**Timeout protocol:** Set a wall-clock limit for each instrumented run:
- Default: 2 minutes (Bash tool timeout)
- If the reproduction command is known to be slow (load test, integration suite):
  use `timeout` parameter up to 10 minutes max
- If a run times out: kill the process, still run cleanup (`git restore . && rm -rf .debug/`),
  mark the hypothesis as `inconclusive` with note "instrumented run timed out"

**When instrumented probing is NOT viable:**
- Reproduction command unavailable → fall back to static-only investigation
- Bug is intermittent / not reproducible locally → skip instrumentation, note in verdict
- Reproduction requires infrastructure not available (database, external service) →
  use static analysis only, recommend manual instrumented probing in diagnostic doc
- Reproduction takes >10 minutes → too slow for per-hypothesis cycling, use static only

When all 3 hypotheses in a batch would be `needs-instrumentation` but probing is not viable,
treat them all as `static` and accept lower-confidence verdicts.

**CRITICAL:** Each hypothesis gets its own instrument-run-analyze-cleanup cycle.
Never leave instrumentation from one hypothesis in place while probing another.

#### Step 4: Verdict Synthesis

Combine results from Step 2 (static) and Step 3 (instrumented) into a unified
verdict set for all 3 hypotheses.

#### Verdict Classification

- `confirmed` (confidence >= 0.7) — Strong evidence supports the hypothesis. Proceed to Phase 4.
- `rejected` (confidence < 0.3 for the claim) — Evidence contradicts the hypothesis. Record why and move on.
- `inconclusive` (0.3 <= confidence < 0.7) — Cannot confirm or reject even with instrumented probing.

#### Multiple Confirmations

If multiple hypotheses are confirmed in the same batch:
- Rank by confidence score
- Test the highest-confidence hypothesis first in Phase 4
- If it resolves the bug, skip the others
- If not, test the next confirmed hypothesis

### Phase 4: Fix & Validate (修复验证)

**This phase is SERIAL.** Only one fix attempt at a time on the working tree.

#### Step 1: Apply Fix

For the highest-confidence confirmed hypothesis:
1. Implement the minimal fix suggested by the investigation
2. Follow project coding style (no extra refactoring)
3. Stage the changes (but do not commit yet)

**Safety protocol:** The fix rollback uses `git restore .` (not stash) to avoid
conflicting with the Phase 3 Step 0 pre-debug stash (if any):
```bash
# To rollback a bad fix:
git restore .
```
This reverts all unstaged changes (the fix) while preserving the Phase 3
pre-debug stash underneath. Do NOT use `git stash push` here — it would
create a second stash entry and complicate the end-of-session cleanup.

#### Step 2: Three-Tier Test Validation

| Tier | What | When | Gate |
|------|------|------|------|
| 1. Specific test | The failing test from the bug report | Always | Must pass |
| 2. Module tests | Test suite for the affected module/directory | If Tier 1 passes | Should pass |
| 3. Full suite | All project tests | Optional (user can request) | Informational |

**No-test codebases:** If the project has no tests covering the affected code:
1. Generate a minimal regression test that captures the bug's symptom
2. Run it to confirm it fails (RED)
3. Apply the fix
4. Run it to confirm it passes (GREEN)
5. Include the test in the commit

#### Step 2.5: Human Confirmation (Optional)

For bugs where automated tests alone cannot confirm resolution (UI rendering,
visual glitches, subjective behavior, hard-to-automate interactions), ask the
user for explicit confirmation.

**Auto-trigger conditions:**
- Bug description mentions UI, visual, display, rendering, animation, layout
- No automated test exists and none was generated in Step 2
- The `--human-confirm` flag was passed

**Protocol:**
1. Present the fix summary and what changed
2. Use `AskUserQuestion`: "I've applied a fix for [bug]. Can you verify:
   [symptom] is resolved? (Yes / No / Partially)"
3. Map answer to outcome:
   - Yes → `resolved`
   - No → `not-resolved`
   - Partially → `partially-resolved`

**Skip conditions:** If all three tiers of automated tests pass AND the bug
type is not UI/visual, skip human confirmation unless `--human-confirm` is set.

#### Step 3: Outcome Classification

| Outcome | Description | Action |
|---------|-------------|--------|
| `resolved` | All tier 1+2 tests pass (+ human confirm if applicable), bug no longer reproduces | Proceed to Phase 6 |
| `partially-resolved` | Some symptoms fixed, others remain | Split: fixed part done, remaining becomes new bug at Phase 1 |
| `not-resolved` | Tests still fail the same way | Discard fix, proceed to Phase 5 |
| `fix-broke-more` | Fix introduced NEW failures | **Immediately rollback** (`git restore .`), record what broke, proceed to Phase 5 |
| `blocked` | Cannot apply fix due to tooling/permission issue | Record blocker, try next hypothesis |

### Phase 5: Loop Control (循环控制)

#### Round Management

```
Round 1: H1, H2, H3  -->  investigate --> fix best --> validate
Round 2: H4, H5, H6  -->  investigate --> fix best --> validate
Round 3: H7, H8, H9  -->  investigate --> fix best --> validate
```

- **Early stop:** If any hypothesis leads to `resolved` status, stop immediately for this bug.
- **Information accumulation:** Each new round's hypothesis generation receives a summary of all prior hypotheses and their verdicts. This prevents repeating dead ends and enables deeper analysis.
- **Hard cap:** After 9 hypotheses (3 rounds), proceed to Phase 6 regardless of outcome.

#### Context Budget Management

Before starting each new round:
1. Estimate remaining context budget
2. If below 30%: compact all prior round evidence into a structured summary
3. The summary preserves: hypothesis claims, verdicts, key evidence snippets, and the narrowed search space
4. Discard verbose tool output (full file contents, long grep results)

#### Multi-Bug Scheduling

When multiple independent bugs exist:
- Process bugs sequentially by priority
- Each bug has its own round counter (independent 9-hypothesis budget)
- If Bug A is `symptom-of` Bug B: fix B first, recheck A before investigating

### Phase 6: Diagnostic Report (诊断文档)

Write a structured diagnostic document. See `diagnostic-schema.md` for the full template.

#### File Path

```
docs/debug/<kebab-case-summary>_<YYYYMMDD-HHMMSS>.md
```

- `<kebab-case-summary>`: 3-5 word slug derived from the bug description (e.g., `api-timeout-retry-loop`)
- `<YYYYMMDD-HHMMSS>`: Timestamp in local time, no colons (Windows-safe)
- Create `docs/debug/` directory if it does not exist
- Add `docs/debug/` to `.gitignore` if not already present (diagnostic docs may contain sensitive data)

#### When to Generate

| Scenario | Document type | Content level |
|----------|--------------|---------------|
| Bug resolved, 1 hypothesis needed | **Skip** (trivial fix) | N/A |
| Bug resolved, 2+ hypotheses needed | **Brief** | All hypotheses + causal chain |
| Bug unresolved after 9 hypotheses | **Detailed** (mandatory) | Full evidence, remaining risks, recommendations |
| Multiple bugs, mixed outcomes | **Combined** | Sections per bug, summary at top |

#### Sensitive Data Handling

Before writing the diagnostic document:
- Strip environment variables from error output
- Redact connection strings, API keys, tokens
- Convert absolute file paths to project-relative paths
- Do not include full file contents; use line-range references instead

## Instrumentation Protocol

Instrumented probing (Phase 3 Step 3) inserts temporary debug statements into
source code to observe runtime behavior. This section defines the format,
placement, and cleanup rules.

### Marker Format

Use language-aware comment markers to fence instrumented code. Every debug
statement is tagged with the hypothesis ID for traceability.

| Language | Region markers | Log statement |
|----------|---------------|---------------|
| Python | `# [DEBUG Hx] START` / `# [DEBUG Hx] END` | `print(f"[DEBUG Hx] {desc}: {var=}", file=sys.stderr)` |
| JavaScript/TypeScript | `// [DEBUG Hx] START` / `// [DEBUG Hx] END` | `console.error("[DEBUG Hx] desc:", var);` |
| Rust | `// [DEBUG Hx] START` / `// [DEBUG Hx] END` | `eprintln!("[DEBUG Hx] desc: {:?}", var);` |
| Go | `// [DEBUG Hx] START` / `// [DEBUG Hx] END` | `fmt.Fprintf(os.Stderr, "[DEBUG Hx] desc: %v\n", var)` |
| Java | `// [DEBUG Hx] START` / `// [DEBUG Hx] END` | `System.err.println("[DEBUG Hx] desc: " + var);` |
| C/C++ | `// [DEBUG Hx] START` / `// [DEBUG Hx] END` | `fprintf(stderr, "[DEBUG Hx] desc: %s\n", var);` |

**Language detection:** Use the file extension of the target file (`.py`, `.js`,
`.ts`, `.rs`, `.go`, `.java`, `.c`, `.cpp`). For unknown extensions, use `#` comments
and `print`-style logging.

**Important:** Always use **stderr** for debug output (`sys.stderr`, `console.error`,
`eprintln!`) to avoid corrupting program stdout which may be structured (JSON,
piped data, MCP transport, etc.).

### Insertion Points

Place instrumentation at locations relevant to the hypothesis's verification plan:

1. **Function entry/exit** — Capture arguments and return values
2. **Conditional branches** — Determine which path was taken
3. **Data transformations** — Observe before/after values
4. **Loop iterations** — Track iteration count or key values (with limit to avoid log spam)
5. **Error handlers** — Confirm whether error paths are reached

**Hard limit:** Maximum **5 instrumentation points** per hypothesis. More than 5
creates noise and makes analysis difficult.

**Files to NEVER instrument:**
- Binary files, images, fonts
- Config/data files: `.json`, `.yaml`, `.yml`, `.toml`, `.xml`, `.csv`
- Generated/minified files: `dist/`, `build/`, `node_modules/`, `__pycache__/`
- Lock files: `package-lock.json`, `Cargo.lock`, `poetry.lock`

### Output Capture

Create a temporary `.debug/` directory in the project root for log capture.
Before first use, ensure `.debug/` is in `.gitignore` to prevent accidental commits
if the session is interrupted mid-investigation:

```bash
mkdir -p .debug
<reproduction_command> 2>&1 | tee .debug/hypothesis.log
```

Cross-platform fallback (if `tee` is unavailable):
```bash
<reproduction_command> > .debug/hypothesis.log 2>&1
```

### Log Analysis

Extract hypothesis-specific log lines:
```bash
grep "\[DEBUG Hx\]" .debug/hypothesis.log
```

Map observed values against the hypothesis's `expected_if_true` and
`expected_if_false` conditions. The verdict is based on whether the
observations match the predicted behavior.

### Cleanup Protocol

After analyzing logs for each hypothesis:

```bash
git restore .          # Remove all instrumentation from tracked files
rm -rf .debug/         # Remove temporary log directory
```

**Verify cleanup:** Run `git status` — working tree should be clean.
If `git restore` fails: try `git checkout -- .` as fallback.

**CRITICAL:** Never proceed to the next hypothesis's instrumentation without
completing cleanup. Residual debug code from H1 corrupts H2's investigation.

### Example Instrumentation

For hypothesis "H2: The cache returns stale data because TTL check uses `<` instead of `<=`":

```python
# [DEBUG H2] START
import sys
print(f"[DEBUG H2] cache_entry.expires_at={cache_entry.expires_at}, now={now}, diff={cache_entry.expires_at - now}", file=sys.stderr)
print(f"[DEBUG H2] is_expired check: {cache_entry.expires_at < now} (using < operator)", file=sys.stderr)
# [DEBUG H2] END
```

After running reproduction, `grep "[DEBUG H2]" .debug/hypothesis.log` might reveal:
```
[DEBUG H2] cache_entry.expires_at=1711612800, now=1711612800, diff=0
[DEBUG H2] is_expired check: False (using < operator)
```
→ **Confirmed**: when `expires_at == now`, the `<` operator returns False (not expired),
but the entry SHOULD be expired. Fix: change `<` to `<=`.

## Continuous Execution Mandate

**CRITICAL:** Like ccplan, this skill runs as a continuous loop. Do NOT stop between phases.
After completing any phase, IMMEDIATELY proceed to the next.

The ONLY reasons to pause:
1. Phase 1 needs user clarification (use `AskUserQuestion`)
2. Bug is `not-reproducible` and needs user help
3. Phase 4 Step 2.5 human confirmation is triggered (UI/visual bugs or `--human-confirm`)
4. Phase 6 is complete (final output)

If none of these apply, execute the next phase without waiting.

## Hypothesis Tracking Format

Track all hypotheses in a running table throughout the session:

```
| Round | ID | Hypothesis (short) | Method | Confidence | Verdict | Evidence (key) |
|-------|----|--------------------|--------|------------|---------|----------------|
| 1     | H1 | Missing backoff    | static | 0.7        | confirmed | No delay in retry loop |
| 1     | H2 | Wrong timeout val  | static | 0.5        | rejected  | Timeout is 30s, appropriate |
| 1     | H3 | Stale cache TTL    | instrumented | 0.4  | confirmed | [DEBUG H3] expires_at==now returns False |
```

Update this table after each investigation round. Present it to the user at phase transitions.

## Integration with Other Skills

| Skill | When to Chain | How |
|-------|--------------|-----|
| tdd-workflow | Phase 4 (no-test codebases) | Generate regression test before fixing |
| build-error-resolver | Phase 4 (fix breaks build) | Delegate build fix to specialist |
| code-reviewer | Phase 4 (after fix applied) | Quick review of the fix |
| verification-loop | Phase 4 (validation) | Build -> type-check -> lint -> test |
| ccplan | Phase 1 (architectural bug) | If bug reveals design flaw, escalate to planning |
| strategic-compact | Phase 5 (context management) | Compact at round boundaries |

## Anti-Patterns

- **Guessing before observing** — Never generate hypotheses without Phase 1 context gathering. Uninformed hypotheses waste all 9 attempts.
- **Parallel file writes** — Phase 3 Step 2 (static analysis) is READ-ONLY. Never let subagents edit files during parallel investigation. File writes in Phase 3 are ONLY allowed in Step 3 (instrumented probing), which runs sequentially with mandatory `git restore` cleanup after each hypothesis.
- **Ignoring prior rounds** — Round 2+ hypotheses must reference Round 1 verdicts. Generating the same hypothesis twice wastes a slot.
- **Over-scoping the fix** — Fix only what the hypothesis identifies. No drive-by refactoring, no "while I'm here" improvements.
- **Skipping rollback** — If a fix makes things worse, rollback IMMEDIATELY before trying the next hypothesis. A corrupted working tree invalidates all subsequent investigation.
- **Treating "inconclusive" as "rejected"** — An inconclusive hypothesis may still be correct; it just needs write-test verification. Prioritize confirmed > inconclusive > rejected when choosing what to fix.
- **Running the full test suite every time** — Use the three-tier strategy. Full suite is expensive and rarely needed for per-hypothesis validation.
- **Stopping at phase boundaries** — This skill runs continuously. Never ask "shall I continue?" between phases.
- **Leaving instrumentation residue** — ALWAYS run `git restore .` + `rm -rf .debug/` after each instrumented hypothesis. Residual debug logs from H1 corrupt H2's investigation and may leak into commits.
- **Instrumenting config/data files** — Never add debug statements to JSON, YAML, XML, or other non-source files. Instrumentation is for source code only.
- **Using stdout for debug logs** — Always use stderr (`sys.stderr`, `console.error`, `eprintln!`). Stdout may be structured output (JSON API, MCP transport, piped data) and debug prints corrupt it.
- **Over-instrumenting** — Max 5 points per hypothesis. More creates noise and makes analysis harder. Place instrumentation at the hypothesis's critical decision point, not everywhere.
- **Skipping git safety** — Always check `git status` before instrumentation. If uncommitted changes exist and bug is in committed code, stash first. Otherwise instrumentation cleanup (`git restore .`) destroys the user's work.

## Examples

### Example 1: Single bug, all-static investigation

```
User: "The API returns 500 when I POST to /users with a long name"

Phase 1: Grep for /users endpoint, find handler. Git log shows recent
         schema change. Reproduce: POST with 200-char name -> 500 error.
Phase 2: H1 (0.8, static): VARCHAR(100) column truncation
         H2 (0.5, static): Missing input validation
         H3 (0.3, static): ORM serialization error
Phase 3: Step 0: Working tree clean, no stash needed.
         Step 1: All 3 classified as `static` (code-structure issues).
         Step 2: 3 subagents investigate in parallel (READ-ONLY).
           H1 confirmed: users.name is VARCHAR(100), no length check.
           H2 rejected: validation exists for other fields, name was missed.
           H3 rejected: ORM handles strings correctly.
         Step 3: Skipped (no needs-instrumentation hypotheses).
Phase 4: Add length validation + increase column to VARCHAR(255).
         Tier 1: POST test passes. Tier 2: User module tests pass.
Phase 5: resolved -> Phase 6.
Phase 6: Skipped (trivial, 1 hypothesis batch needed).
```

### Example 2: Dual-track investigation with instrumented probing

```
User: "Intermittent test failure in CI but passes locally"

Phase 1: Pull CI logs, compare env. No obvious difference.
         State: reproduced (in CI), not-reproducible (locally).
Phase 2 Round 1:
         H1 (0.6, needs-instrumentation): Race condition in async test
         H2 (0.5, static): CI uses different timezone
         H3 (0.4, static): Test depends on network (CI is sandboxed)
Phase 3: Step 0: Working tree clean, no stash needed.
         Step 1: Triage → H1=needs-instrumentation (timing), H2/H3=static.
         Step 2: Parallel static → H2 rejected (timezone-agnostic),
                 H3 rejected (no network calls).
         Step 3: Instrumented probing for H1:
           Insert [DEBUG H1] logs at async task spawn + completion points.
           Run test 5 times → grep "[DEBUG H1]" .debug/hypothesis.log
           Observe: task ordering varies across runs, sometimes overlapping.
           Verdict: inconclusive (race likely but exact shared state unknown).
           Cleanup: git restore . && rm -rf .debug/
Phase 4: Skip (no confirmed hypothesis).
Phase 5: not-resolved -> Round 2. Evidence: timing-related, not env.
         H1 inconclusive → auto-upgraded to needs-instrumentation for Round 2.
Phase 2 Round 2 (informed by Round 1):
         H4 (0.7, needs-instrumentation): Shared mutable state between parallel tests
         H5 (0.6, static): Database connection pool exhaustion under CI load
         H6 (0.4, static): Filesystem ordering difference (CI uses tmpfs)
Phase 3: Step 2: Parallel static → H5 rejected, H6 rejected.
         Step 3: Instrumented probing for H4:
           Insert [DEBUG H4] logs around global cache reads/writes in test setup.
           Run test 3 times → grep "[DEBUG H4]"
           Output: "[DEBUG H4] cache.set key=user_1 in test_A, thread=140..."
                   "[DEBUG H4] cache.get key=user_1 in test_B, thread=141..."
           Confirmed: test_B reads cache written by test_A in parallel.
           Cleanup: git restore . && rm -rf .debug/
Phase 4: Add per-test cache isolation. Tier 1: passes. Tier 2: passes.
Phase 5: resolved -> Phase 6.
Phase 6: Brief doc with instrumentation log (6 hypotheses, 2 rounds,
         2 instrumented investigations).
```

### Example 3: UI bug with human confirmation

```
User: "Dashboard charts flicker when switching tabs"

Phase 1: Browser-based UI bug, no test coverage for animations.
         Reproduce: open dashboard, switch between Overview/Details tabs.
Phase 2: H1 (0.7, static): Component re-mounts on tab switch
         H2 (0.5, needs-instrumentation): Chart library re-renders with
           empty data during async fetch
         H3 (0.3, static): CSS transition conflict
Phase 3: Step 2: H1 confirmed (static): tab component uses key={tab}
           causing full unmount/remount. H3 rejected.
         Step 3: H2 skipped (H1 already confirmed with higher confidence).
Phase 4: Fix: use conditional visibility instead of key-based remount.
         Tier 1: No specific test exists.
         Step 2.5: Human confirmation triggered (UI/visual bug, no tests).
           → AskUserQuestion: "Can you verify the chart flicker is resolved?"
           → User: "Yes, smooth transition now."
Phase 5: resolved -> Phase 6.
Phase 6: Skipped (--no-doc, trivial once root cause found).
```

### Example 4: Unresolved, diagnostic doc generated

```
User: "Memory usage grows unbounded after 24h of running the service"

Phase 1: No crash, no error. Reproduce: run load test for 10min,
         observe RSS growth. State: reproduced.
[Rounds 1-3: 9 hypotheses tested (5 static, 4 instrumented).
 Static: connection pool config, cache eviction policy, circular refs,
   logging buffer config, middleware state storage.
 Instrumented: event listener count growth, goroutine leak rate,
   serialization buffer reuse pattern, timer accumulation.
 Instrumented probing revealed: event listener count stable, goroutines
   stable, serialization buffers properly freed. Timer count growing
   but not enough to explain RSS growth.]
Phase 5: 9 hypotheses exhausted, not-resolved.
Phase 6: Detailed diagnostic doc at docs/debug/unbounded-memory-growth_20260327-143022.md
         Includes: all 9 hypotheses with evidence, instrumentation logs
         from 4 probes, narrowed scope to "likely in middleware layer
         based on H4-H6 findings", recommends: heap profiling with
         production traffic pattern.
```
