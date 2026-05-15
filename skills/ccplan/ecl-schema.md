# Evolving Constraint Language (ECL) — Schema Reference

## Overview

ECL is a YAML-based document format that captures the full lifecycle of
requirement engineering: from raw hypotheses through adversarial validation
to implementation constraints. It is designed to be read by any LLM agent
cold — no prior session context needed.

## File Location

```
docs/ecl/<feature-name>.yaml
```

One ECL file per feature. For multi-feature projects, create separate files
and cross-reference via `related_features`.

## Full Schema

```yaml
# ─── Header ────────────────────────────────────────────────────
ecl_version: "1.0"
feature: "kebab-case-feature-name"
status: "phase-N-description"  # e.g. phase-0-calibration, phase-6-completion, phase-10-implementing
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
related_features: []  # cross-references to other ECL files
owner: "user or team identifier"  # optional

# ─── Conversation State ──────────────────────────────────────
# Tracks what the skill is waiting for from the user.
# Set to null when no user input is needed.
# Used for cold-start recovery after context compaction.
pending_input:
  phase: 2
  question: "What is your latency target: <100ms, <500ms, or <2s?"
  context: "Clarifying REQ-001 vague 'fast' requirement"
  type: single-choice   # single-choice | multi-choice | free-text | approval | selection
  options: ["<100ms", "<500ms", "<2s"]  # populated for choice/selection types

# ─── Prompt Calibration (Phase 0) ─────────────────────────────
# Output of Phase 0. Records how raw input was transformed.
prompt_calibration:
  raw_input: "The user's original words, verbatim"
  status: completed    # completed | skipped

  # ── Step 1: Multi-Intent Decomposition ──
  # Identifies distinct requirements in a single prompt and groups them.
  # Single-intent prompts produce one track; multi-intent prompts produce 2+.
  intent_decomposition:
    total_intents: 1       # number of atomic intents detected
    total_tracks: 1        # number of tracks formed
    tracks:
      - track_id: T1       # T1, T2, T3, ...
        name: "short descriptive name for this track"
        priority: 1        # 1 = highest priority
        intents:
          - raw: "user's original wording for this intent"
            type: feature  # feature | bugfix | refactor | migration | chore
        relationship_to_other_tracks:
          T2: independent  # coupled | related | independent

  # ── Steps 2-6: Per-Track Calibration ──
  # Each track gets its own calibrated_scenario and intent_dimensions.
  # For single-track prompts, this is a flat structure under T1.
  tracks:
    T1:
      calibrated_scenario: |
        The enriched, structured scenario brief produced by Phase 0.
        All anti-patterns resolved, missing dimensions filled.
      intent_dimensions:
        task: { status: present, value: "extracted task" }
        input: { status: present, value: "what system receives" }
        output: { status: implicit, value: "what system produces" }
        constraints: { status: missing, resolved: "discovered constraint" }
        context: { status: enriched, value: "project context from codebase scan" }
        audience: { status: missing, resolved: "identified audience" }
        memory: { status: present, value: "prior decisions from conversation" }
        success_criteria: { status: missing, resolved: "measurable targets" }
        examples: { status: missing, deferred: true }

  anti_patterns_found:
    - category: task       # task | context | scope
      raw: "the problematic fragment"
      fix: "how it was resolved"
  context_enrichment:
    codebase: "relevant findings from grep/glob"
    git: "relevant findings from git history"
    conversation: "relevant prior decisions"
  questions_asked: 0       # 0-3 per track
  questions_skipped: "reason for skipping"

# ─── Original Context ──────────────────────────────────────────
# Preserve the user's original words. Never edit this section.
user_scenario: |
  The original user description, verbatim.
  Preserve typos, ambiguity, and all.

# ─── Requirements ──────────────────────────────────────────────
requirements:
  - id: REQ-001          # Sequential ID, never reused
    text: "Human-readable requirement statement"
    status: hypothesis    # hypothesis → validated → verified → implemented
                          # OR: invalidated, deferred, superseded
    confidence: 0.0-1.0   # Confidence in correctness/feasibility
    source: user-stated   # user-stated | inferred | critic-proposed | probe-result
    priority: must        # must | should | could | wont (MoSCoW)
    acceptance_criteria:
      - "Concrete, testable condition 1"
      - "Concrete, testable condition 2"
    challenges:           # From Phase 2
      - "Open question or concern"
    decomposition:
      features: [FEAT-001]
    tags: []              # Free-form labels for filtering
    history:              # Append-only audit trail
      - phase: 2
        action: "Description of what happened"
        date: "YYYY-MM-DD"
        agent: "phase-2-interrogator"  # optional

# ─── Features ──────────────────────────────────────────────────
features:
  - id: FEAT-001
    name: "Human-readable feature name"
    parent: REQ-001       # Which requirement this serves
    modules: [MOD-001]
    dependencies: []      # Other FEAT-IDs this depends on
    complexity: small     # trivial | small | medium | large
    status: pending       # pending | in-progress | done | blocked

# ─── Modules ──────────────────────────────────────────────────
# Each module is an INDEPENDENT, PLUGGABLE unit. It communicates with the
# outside world ONLY through its declared interfaces. It can be tested,
# replaced, or reused in isolation without affecting other modules.
modules:
  - id: MOD-001
    name: "Human-readable module name"
    parent: FEAT-001
    config_slot: "modules.feature"   # Which slot in devcompanion.config.ts
    functions: [FN-001, FN-002]
    file_path: "packages/core/src/auth/"  # Derived from config_slot
    entry_point: "index.ts"          # Public API surface — other modules import ONLY from here
    source: new                      # new | existing | extend (from reuse_discovery)
    public_interface:                # What this module EXPORTS (its contract with the world)
      - name: "authenticate"
        signature: "(credentials: AuthInput) => Promise<AuthResult>"
        description: "Single entry point for authentication"
      - name: "AuthInput"
        kind: type                   # type | interface | class | const
        description: "Input contract for authentication"
      - name: "AuthResult"
        kind: type
        description: "Output contract — success token or typed error"
    dependencies:                    # What this module IMPORTS (other modules' interfaces it uses)
      - module: MOD-003
        imports: ["SessionStore"]    # Imported from MOD-003's entry_point only
        why: "Persists session after successful auth"
      - module: config
        imports: ["authProvider"]    # Read from devcompanion.config.ts
        why: "Provider URL, client ID — no hardcoded values"
    internal_only:                   # NOT exported — invisible to other modules
      - "validateToken"
      - "buildOAuthUrl"
      - "parseCallbackParams"
    modularity_check:                # Verified before implementation
      single_responsibility: true    # Does one thing well?
      testable_in_isolation: true    # Can mock all dependencies?
      no_shared_state: true          # No globals or singletons?
      config_at_boundary: true       # Reads config at entry, not deep inside?

# ─── Functions ─────────────────────────────────────────────────
# Each function has explicit input/output types. No implicit dependencies
# on module-internal state or other functions' implementation details.
functions:
  - id: FN-001
    name: "functionName"
    parent: MOD-001
    visibility: public              # public (exported via entry_point) | internal
    description: "What this function does"
    input_interface:                 # Explicit typed inputs — the function's contract
      - name: "credentials"
        type: "AuthInput"
        source: parameter           # parameter | config | injected-dependency
    output_interface:                # Explicit typed output
      type: "Promise<AuthResult>"
      error_cases:
        - type: "AuthError"
          when: "invalid or expired credentials"
    side_effects: []                 # List any side effects (DB write, network call, file I/O)
                                    # Empty = pure function (preferred)
    dependencies:                   # Other functions/modules this calls
      - "SessionStore.save"         # Via injected interface, NOT direct import of internals
    constraints:                    # Performance, security, invariant requirements
      - "Performance: <200ms p99"
      - "Must not throw — returns typed error instead"
    test_cases:                     # Derived from constraints in Phase 10
      - input: "valid credentials"
        expected: "returns AuthResult with token"
        mocks: ["SessionStore.save → resolves"]
      - input: "expired credentials"
        expected: "returns AuthError with code EXPIRED"
        mocks: []

# ─── Probes ────────────────────────────────────────────────────
probes:
  - id: PROBE-001
    target: FEAT-001      # What this probe validates
    question: "Single question this probe answers"
    method: spike         # spike | benchmark | integration-test | manual-test
    code_path: "scripts/probes/probe-001.ts"  # Where the probe code lives
    result: null          # Filled after execution. Free-form text.
    verdict: null         # feasible | infeasible | needs-modification
    date: null
    impact_if_infeasible:
      invalidates: [FEAT-001]       # What gets killed
      alternatives: [FEAT-001-alt]  # Fallback approaches

# ─── Confrontation ─────────────────────────────────────────────
confrontation:
  red_team:
    - id: ATK-001
      scenario: "Description of the attack/edge case"
      severity: critical  # critical | high | medium | low
      targets: [REQ-001, FEAT-002]  # What this attacks
  blue_team:
    - attack: ATK-001
      verdict: defended   # defended | mitigated | vulnerable
      mitigation: "Description of defense (if mitigated)"
      new_requirements: []  # REQ-IDs created from mitigations

# ─── Dependency Graph ──────────────────────────────────────────
dependency_graph:
  # feature-id: [list of feature-ids it depends on]
  FEAT-001: []
  FEAT-002: [FEAT-001]
  FEAT-003: [FEAT-001]
  FEAT-004: [FEAT-002, FEAT-003]

# ─── Risk Register ─────────────────────────────────────────────
risks:
  - id: RISK-001
    description: "What could go wrong"
    probability: medium   # high | medium | low
    impact: high          # high | medium | low
    mitigation: "How we address it"
    status: mitigated     # open | mitigated | accepted | closed
    related: [ATK-001]    # Link to confrontation attacks

# ─── Decisions Log ─────────────────────────────────────────────
# Append-only record of key decisions. Never delete entries.
decisions:
  - id: DEC-001
    date: "YYYY-MM-DD"
    phase: 2
    decision: "Chose CRDT approach over OT for conflict resolution"
    rationale: "Better offline support, simpler mental model, Yjs is mature"
    alternatives_considered:
      - "OT — rejected due to server complexity"
      - "Last-write-wins — rejected due to data loss risk"
    reversible: true      # Can this decision be changed later?

# ─── Iteration Log ─────────────────────────────────────────────
# Tracks feedback loop entries (Phase 11)
iterations:
  - id: ITER-001
    date: "YYYY-MM-DD"
    trigger: "WebSocket probe showed 300ms latency, exceeding REQ-002 target"
    classification: requirement-gap  # implementation-bug | requirement-gap |
                                     # requirement-error | architecture-problem
    routed_to: phase-7   # Which phase this re-enters
    resolution: "Switched to SSE for non-collaborative updates, kept WS for edits"
    affected_items: [REQ-002, FEAT-003, MOD-005]

# ─── Feature Guard (特性守卫) ────────────────────────────────
# Auto-generated at Phase 10 exit. Protects implemented features from
# accidental regression during bug fixes or subsequent feature work.
# Any agent modifying a guarded file MUST check invariants first.
# See SKILL.md "Feature Guard Protocol" for the full behavioral spec.
feature_guard:
  generated: "YYYY-MM-DD"         # When guards were last generated/updated
  guards:
    - id: GUARD-001               # Sequential ID, never reused
      feature: FEAT-001           # Which feature this guard protects
      description: "Human-readable summary of what's protected"
      key_files:                   # Files that, if modified, could affect this feature
        - "src/auth/google-oauth.ts"
        - "src/auth/session.ts"
      invariants:                  # Behaviors that MUST be preserved (from acceptance_criteria)
        - "Clicking 'Sign in with Google' redirects to Google consent screen"
        - "After consent, user is redirected back with a valid session"
        - "User profile (name, email, avatar) is stored in the database"
      verification:
        command: "pytest tests/test_auth.py"  # Command to verify invariants hold
        expected: "all pass"                   # Expected outcome
      status: active               # active | suspended | retired
      suspended_reason: null       # Reason for suspension (if applicable)
      retired_date: null           # When retired (if applicable)
      history:                     # Append-only audit trail for this guard
        - date: "YYYY-MM-DD"
          action: "Generated from FEAT-001 acceptance criteria"
```

## Status Lifecycle

```
Requirements:   hypothesis → validated → verified → implemented
                    ↓                       ↓
               invalidated              superseded
                    ↓
                deferred

Features:       pending → in-progress → done
                    ↓
                 blocked

Probes:         null → feasible | infeasible | needs-modification

Guards:         active → suspended → retired
                           ↓
                        active (re-activated)
```

## Naming Conventions

| Prefix | Entity |
|--------|--------|
| REQ-   | Requirement |
| FEAT-  | Feature |
| MOD-   | Module |
| FN-    | Function |
| PROBE- | Feasibility probe |
| ATK-   | Red team attack |
| RISK-  | Risk register entry |
| DEC-   | Decision log entry |
| ITER-  | Iteration log entry |
| GUARD- | Feature guard entry |

IDs are sequential within their prefix and **never reused**, even if the item
is invalidated. This preserves audit trail integrity.

## Cold-Start Protocol

When a new agent (new session, different model, after compaction) encounters
an ECL document:

1. Read the `status` field to determine current phase
2. Read the `pending_input` field — if not null, the user's latest message is likely the answer to this question. Process it and continue.
3. Read the `iterations` log for recent context
4. Read all items with `status: verified` or `status: in-progress`
5. Resume from the current phase without repeating completed phases
6. If implementation is in progress, check `functions` for items without
   `test_cases` populated — those are next to implement
7. If `feature_guard` section exists with `active` guards, enforce the
   Pre-Modification Check protocol before editing any guarded file —
   see SKILL.md "Feature Guard Protocol"

## Size Guidelines

| Project Size | Expected ECL Items |
|-------------|-------------------|
| Small (1-2 PRs) | 3-5 REQs, 5-10 FEATs, 10-20 FNs |
| Medium (3-5 PRs) | 10-20 REQs, 20-40 FEATs, 40-80 FNs |
| Large (6+ PRs) | 20-50 REQs, 40-100 FEATs, split into sub-ECL files |

If a single ECL file exceeds 50 requirements, decompose into sub-features
with separate ECL files linked via `related_features`.
