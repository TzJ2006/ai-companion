---
name: ccdiscuss
description: >-
  Best-effort conversational alignment loop that runs BEFORE /ccplan. Walks the
  human and the AI through a 6-step discipline to align on a single idea before
  any planning begins: check for conflicts/duplication against existing ECLs,
  have the HUMAN write the expected result FIRST, surface the AI's 5 questions
  (是什么 / 为什么做 / 如何做 / 为什么这样做 / 期望结果) while flagging where the
  two understandings diverge, resolve the divergence on the spot, define how to
  verify actual == expected as value(s) + comparison code (or soft + human
  sign-off), then split the aligned idea into one or more ECL nodes that each
  carry the 5 questions. Produces an aligned ECL that /ccplan reads IF PRESENT —
  there is no hard prerequisite, no gate, no enforcement.
  TRIGGER when: user has a fresh idea and wants to align on intent before
  planning; user says "ccdiscuss", "对齐", "对齐需求", "let's align", "discuss
  the idea", "聊聊这个想法", or invokes /ccdiscuss.
  DO NOT TRIGGER when: the idea is already aligned and the user wants to plan
  (use /ccplan), execute (use /ccedit), debug (use /ccdebug), or onboard
  (use /cconboard); or when the user says "just do it" / "直接写代码".
origin: custom
---

# /ccdiscuss — Conversational Alignment Loop

## Core Premise

> **Alignment is cheaper than rework.**
> Before a single requirement is planned, the human and the AI should agree on
> what the idea *is*, why it exists, and how anyone will know it succeeded.
> /ccdiscuss is the short conversation that buys that agreement.

This is **best-effort conversational discipline**, not a mechanism. It is a
checklist the participants choose to follow because it surfaces misunderstanding
early. It is explicitly:

- **NOT always-on** — you invoke it when you want to align; it does nothing
  unless invoked.
- **NOT enforced** — no hook, no guard, no marker file blocks anything if you
  skip it.
- **NOT a gate** — /ccplan does **not** require a /ccdiscuss artifact to run.

The enforcement layer (making alignment a hard prerequisite) is **deferred** and
intentionally out of scope. Treat the steps below as a discipline you can follow
loosely or skip — its only power is that, when followed, it catches divergence
between human intent and AI inference before that divergence becomes code.

## When to Use

- You have a fresh idea and want to pin down intent before planning.
- You suspect your idea overlaps with something already built or planned.
- You want to confirm the AI understands the idea the same way you do.
- You want a crisp, value-based definition of "done" before scope grows.

**Do NOT use** for ideas already aligned (go straight to /ccplan), for
single-file fixes, or when the user says "just do it." For those, proceed
directly.

## Relationship to /ccplan (Read-If-Present Handoff)

/ccdiscuss runs **before** /ccplan and hands off through the ECL document — the
same persistent artifact /ccplan already reads.

```
human idea
    │
    ▼
/ccdiscuss  ──(best-effort alignment loop)──▶  aligned ECL node(s)
                                                  │
                                                  ▼  (read IF PRESENT)
                                               /ccplan  ──▶ full planning spiral
```

**Handoff contract — read-if-present, no hard prerequisite:**

- /ccdiscuss **writes** an aligned ECL (`docs/ecl/<feature>.yaml`) containing the
  5 questions per node, the human-authored expected result, the resolved
  divergences, and the verification definition.
- /ccplan **reads that ECL if it is present.** When a /ccdiscuss-aligned ECL
  exists, /ccplan's Phase 0 (Prompt Calibration) and Phase 2 (Hypothesis
  Interrogation) can be fast-tracked, because intent is already aligned.
- If **no** /ccdiscuss artifact exists, /ccplan runs exactly as it always has.
  /ccplan never blocks, errors, or refuses on a missing alignment artifact —
  alignment is an input it *uses when available*, not a precondition it
  *demands*.

This is a soft handoff by design: the value is the aligned content, not a
gatekeeping check.

## Read-Only Mode

Like /ccplan, /ccdiscuss is a thinking-and-aligning workflow, not an
implementation one. The ONLY files it writes are ECL documents
(`docs/ecl/*.yaml`). It does not edit source code, create tests, or run
destructive commands. Implementation is the job of /ccedit; deeper planning is
the job of /ccplan.

## The Six Steps

The loop is six steps, run in order, **best-effort**. Any step may be shortened
or skipped by mutual agreement — the discipline is the default, not a
requirement.

### Step 1: Conflict / Duplication Check (冲突 / 重复检查)

Before discussing anything new, check the idea against what already exists.

**Reuse the ccplan Phase 1 "ECL Reuse Discovery" procedure** — do not reinvent
it. Concretely:

1. Scan ALL existing ECL files in `docs/ecl/` and build a reuse inventory of
   implemented/planned FEAT, MOD, and FN items (exactly as ccplan Phase 1
   "ECL Reuse Discovery" describes).
2. Match the new idea against that inventory and classify each touch point as
   `reuse-direct`, `reuse-extend`, `reuse-adapt`, or `new`.
3. Surface conflicts and duplication explicitly: "This overlaps with
   `MOD-001` in `diff-annotation.yaml` — is this the same thing, an extension,
   or genuinely new?"

If the idea is fully covered by existing work, say so and stop — there may be
nothing to align. Otherwise carry the reuse map into the rest of the loop.

### Step 2: Human Writes the Expected Result FIRST (人先写期望结果)

**The HUMAN writes the expected result first, in natural language, BEFORE the AI
reveals its inference.** This ordering is the heart of the loop.

- Ask the human: "In your own words, what should be true when this is done?"
- Capture the human's answer verbatim as `expected_result_human`.
- The AI MUST NOT show its own 5 questions or its inferred expected result until
  the human has written theirs. This prevents the human from anchoring on (and
  rubber-stamping) the AI's framing.

This is the one ordering rule the loop cares about most: **human expectation is
recorded before AI inference is revealed.**

### Step 3: AI Emits the 5 Questions + Flags Divergence (AI 提 5 问并标注分歧)

Only now does the AI reveal its understanding, structured as the **5 questions**:

| # | Question | 中文 | What it pins down |
|---|----------|------|-------------------|
| 1 | What is it? | 是什么 | The thing being built / changed |
| 2 | Why do it? | 为什么做 | The motivation / problem it solves |
| 3 | How to do it? | 如何做 | The approach / mechanism |
| 4 | Why this way? | 为什么这样做 | The rationale for that approach over alternatives |
| 5 | Expected result? | 期望结果 | The AI's inferred definition of done |

Alongside each answer, the AI **flags where its understanding diverges from the
human's** Step 2 expected result. For every question, mark one of:

- `aligned` — AI's understanding matches the human's expectation.
- `divergent` — AI's understanding differs; state *how* it differs, concretely.
- `unknown` — AI cannot tell whether it aligns; needs the human to clarify.

The divergence flags are mandatory output of this step — an answer with no
alignment marker is incomplete. Compare especially question 5 (期望结果) against
`expected_result_human` from Step 2.

### Step 4: Resolve the Divergence On the Spot (当场消解分歧)

For every item flagged `divergent` or `unknown` in Step 3, resolve it
immediately in conversation — do not defer it to planning.

1. Present each divergence as a concrete choice (prefer multiple-choice).
2. Let the human pick, correct, or merge the two understandings.
3. Update the affected 5-question answers and the expected result to the
   reconciled version.
4. Re-flag: every item should end this step as `aligned` (or be explicitly
   recorded as a deferred open question with the human's consent).

Exit Step 4 when the human-authored expectation and the AI's 5 answers describe
the same idea, or the human accepts a documented residual gap.

### Step 5: Define Verification — value(s) + comparison code (定义验证)

Define how anyone will guarantee **actual == expected**. The preferred form is
**one or more values (number / boolean) plus comparison code**:

```yaml
verification:
  kind: value            # value | soft
  checks:
    - name: "latency_p95_ms"
      type: number
      expected: 100
      comparison: "actual <= expected"   # comparison code: pass when true
    - name: "oauth_login_succeeds"
      type: boolean
      expected: true
      comparison: "actual === expected"
```

Rules:

- Reduce the expected result to **concrete value(s)** — a number, a boolean, or a
  set of them — and a **comparison expression** that returns pass/fail.
- Each check names what is measured, its type, the expected value, and the
  comparison code that decides pass/fail.
- **If the expected result cannot be reduced to a value** (e.g. "the UX should
  feel cleaner"), set `kind: soft` and require **explicit human sign-off**:

  ```yaml
  verification:
    kind: soft
    rationale: "Subjective UX quality — no single value captures it."
    sign_off:
      required: true
      approver: human
      status: pending      # pending | approved
  ```

A `soft` verification is a deliberate, recorded admission that the check is
human judgment — not a failure of the loop. Prefer `value` whenever the
expectation *can* be made numeric or boolean.

### Step 6: Split Into ECL Node(s), Each Carrying the 5 Questions (切分为 ECL 节点)

Split the aligned idea into **one or more ECL nodes**. Each node carries its own
copy of the 5 questions so that any downstream agent (including /ccplan) reads a
self-contained, aligned unit.

- A simple idea → a single ECL node.
- A compound idea → multiple nodes (one per cohesive sub-idea), each with its own
  5 questions, expected result, resolved divergences, and verification block.
- Persist to `docs/ecl/<feature>.yaml`. Each node records the reuse
  classification from Step 1 (`reuse-direct` / `reuse-extend` / `new`).

Example node shape (illustrative):

```yaml
ecl_nodes:
  - id: NODE-001
    five_questions:
      what: "Add Google OAuth login"
      why: "Reduce signup friction for B2B customers"
      how: "Use NextAuth Google provider against existing users table"
      why_this_way: "Avoids hand-rolling token exchange; reuses session module"
      expected_result: "A new user can sign in with Google in under 3 seconds"
    expected_result_human: "I click Google, approve, and I'm logged in fast"
    alignment:
      what: aligned
      why: aligned
      how: aligned
      why_this_way: aligned
      expected_result: aligned   # reconciled in Step 4
    reuse: reuse-extend
    verification:
      kind: value
      checks:
        - name: "google_login_latency_ms"
          type: number
          expected: 3000
          comparison: "actual <= expected"
        - name: "session_created"
          type: boolean
          expected: true
          comparison: "actual === expected"
```

After Step 6, announce that the aligned ECL is written and that /ccplan can be
run next — it will read this ECL **if present**, with no hard prerequisite.

## Loop Summary

1. **Conflict / duplication check** — reuse ccplan Phase 1 "ECL Reuse Discovery".
2. **Human writes expected result FIRST** — before AI reveals its inference.
3. **AI emits the 5 questions + flags divergence** — 是什么 / 为什么做 / 如何做 /
   为什么这样做 / 期望结果, each marked aligned / divergent / unknown.
4. **Resolve divergence on the spot** — reconcile every flag in conversation.
5. **Define verification** — value(s) + comparison code, else `kind: soft` +
   human sign-off.
6. **Split into ECL node(s)** — each carrying the 5 questions; persist to
   `docs/ecl/`.

The whole loop is best-effort: a discipline that makes misunderstanding cheap to
catch, handed off to /ccplan as an aligned ECL it reads when available — never a
gate it must pass.
