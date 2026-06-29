# Diagnostic Document Schema

## Overview

Diagnostic documents record the complete debugging process for a bug: what was
tried, what was found, and what remains. They serve as an audit trail that
prevents future debugging sessions from repeating dead ends.

## File Location

```
docs/debug/<kebab-case-summary>_<YYYYMMDD-HHMMSS>.md
```

- `<kebab-case-summary>`: 3-5 word slug from the bug description (e.g., `api-timeout-retry-loop`)
- `<YYYYMMDD-HHMMSS>`: Local timestamp, no colons (Windows-safe)
- Create `docs/debug/` if it does not exist
- Add `docs/debug/` to `.gitignore` if not already present

## Generation Rules

| Scenario | Generate? | Detail Level |
|----------|-----------|-------------|
| Resolved, 1 hypothesis, trivial fix | No (skip) | N/A |
| Resolved, 2+ hypotheses tested | Yes | Brief |
| Unresolved after 9 hypotheses | Yes (mandatory) | Detailed |
| Multiple bugs, mixed outcomes | Yes | Combined (sections per bug) |
| `--no-doc` flag used + resolved | No | N/A |

## Template

```markdown
# Bug: <descriptive title>

**Date:** YYYY-MM-DD HH:MM
**Status:** resolved | unresolved | partially-resolved
**Rounds completed:** N/3
**Hypotheses tested:** M/9
**Files modified:** N (list below)

---

## Bug Description

<What the user reported. Include: symptom, expected behavior, trigger conditions.>

### Reproduction

<Steps to reproduce, or "not-reproducible" with explanation.>

### Environment

- **OS:** <e.g., Windows 11, Ubuntu 22.04>
- **Runtime:** <e.g., Python 3.10.12, Node 22.1.0>
- **Key dependencies:** <relevant packages and versions>
- **Configuration:** <any relevant config settings>

---

## Bug Decomposition

<Only present if multiple bugs were identified.>

| Bug | Relationship | Priority | Status |
|-----|-------------|----------|--------|
| Login timeout | root | 1 | resolved |
| Dashboard stale | symptom-of Login | 2 | resolved (auto) |

---

## Hypotheses Tested

| Round | ID | Hypothesis | Method | Confidence | Verdict | Key Evidence |
|-------|-----|-----------|--------|------------|---------|--------------|
| 1 | H1 | <claim> | static | 0.7 | confirmed | <1-line evidence> |
| 1 | H2 | <claim> | static | 0.5 | rejected | <1-line evidence> |
| 1 | H3 | <claim> | instrumented | 0.4 | rejected | <1-line evidence> |
| 2 | H4 | <claim> | instrumented | 0.6 | confirmed | <1-line evidence> |

### Detailed Evidence

#### H1: <hypothesis claim>

**Verification plan:**
1. <step 1>
2. <step 2>

**Findings:**
- <evidence point 1>
- <evidence point 2>

**Verdict:** confirmed / rejected / inconclusive
**Reasoning:** <why this verdict>

<Repeat for each hypothesis. Brief docs may use the table only, without
detailed evidence sections.>

---

## Instrumentation Log

<Only present if any hypothesis used instrumented probing.>

| Hypothesis | Files Instrumented | Points | Key Log Output |
|------------|-------------------|--------|----------------|
| H3 | `src/cache/store.py:42-58` | 3 | `[DEBUG H3] expires_at=1711612800, now=1711612800, is_expired=False` |
| H4 | `src/api/handler.py:120-135` | 2 | `[DEBUG H4] request_id=abc entered retry loop, attempt=4` |

### Instrumentation Details

#### H3: <hypothesis claim>

**Instrumentation points:**
1. `src/cache/store.py:45` — Cache TTL comparison values
2. `src/cache/store.py:52` — is_expired return value
3. `src/cache/store.py:58` — Cache hit/miss decision

**Log output (filtered):**
```
[DEBUG H3] expires_at=1711612800, now=1711612800, diff=0
[DEBUG H3] is_expired check: False (using < operator)
[DEBUG H3] cache decision: HIT (returning stale data)
```

**Analysis:** Log confirms expires_at equals now, `<` returns False, stale data served.

<Repeat for each instrumented hypothesis.>

---

## Root Cause

<Only present if bug was resolved.>

**Causal chain:**
```
Symptom: <what user observed>
    |
    v
Proximate cause: <the direct trigger>
    |
    v
Root cause: <the underlying reason>
```

**Why it wasn't caught earlier:** <optional — what made this bug non-obvious>

---

## Fix Applied

<Only present if bug was resolved.>

**Approach:** <1-2 sentence summary>

**Changes:**

| File | Change |
|------|--------|
| `src/api/client.py` | Added exponential backoff to retry loop |
| `tests/test_api.py` | Added regression test for retry behavior |

**Commit:** <hash, if committed>

---

## Remaining Risks

<Present in both resolved and unresolved docs.>

- <Risk 1: e.g., "Backoff max delay is hardcoded; may need tuning under heavy load">
- <Risk 2: e.g., "Similar retry pattern exists in src/api/webhook.py, not yet fixed">

---

## Recommended Follow-up

<Present in both resolved and unresolved docs. More detailed for unresolved.>

- [ ] <Action 1: e.g., "Profile memory under production traffic patterns">
- [ ] <Action 2: e.g., "Add monitoring alert for retry rate > 10/min">
- [ ] <Action 3: e.g., "Review similar patterns in other API clients">

---

## Investigation Narrowing (unresolved only)

<Only present if bug is unresolved after 9 hypotheses.>

**What we know:**
- <Confirmed fact 1 from investigation>
- <Confirmed fact 2>

**What we eliminated:**
- <Eliminated cause 1 with evidence>
- <Eliminated cause 2 with evidence>

**Narrowed scope:**
<Where the bug most likely lives based on elimination. E.g., "Evidence points to
the middleware layer — all application and database hypotheses were rejected.
Specifically, request lifecycle hooks between auth and rate limiting.">

**Suggested next approach:**
<What a fresh debugging session should try. E.g., "Attach a heap profiler to
the staging environment under sustained load. Focus on objects created in the
middleware pipeline. The 9 hypotheses tested here cover application logic and
database interactions — the middleware layer remains unexplored.">
```

## Sensitive Data Rules

Before writing the document, sanitize:

| Data Type | Action |
|-----------|--------|
| Environment variables | Strip entirely (replace with `$ENV_VAR_NAME`) |
| API keys, tokens, secrets | Replace with `[REDACTED]` |
| Connection strings | Replace credentials with `***` |
| Absolute file paths | Convert to project-relative paths |
| Full file contents | Use line-range references (e.g., `src/foo.py:42-58`) |
| Database query results | Include schema/structure only, not row data |
| User PII in test data | Replace with placeholder values |
