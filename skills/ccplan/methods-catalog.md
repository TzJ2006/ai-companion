# Methods Catalog — Divergent and Convergent Techniques

Reference catalog for Phase 2 (Divergent Exploration) and Phase 4 (Adversarial
Filtering). Select methods based on the problem type. Not all methods are needed
for every project — pick 2-3 that fit.

## Divergent Methods (Expand Possibility Space)

### First Principles Decomposition
Strip away assumptions. Ask: "What are the fundamental truths here?"
Break the problem into its smallest components and rebuild from scratch.
Best for: architectural decisions, technology selection.

### Inversion
"What if we solved the opposite problem?"
"What would guarantee failure? Now avoid all of that."
Best for: uncovering hidden requirements, stress-testing assumptions.

### Analogy Transfer
"How does [banking/gaming/logistics/biology] solve this class of problem?"
Cross-pollinate solutions from unrelated domains.
Best for: novel problems where the team is stuck.

### SCAMPER
Systematic checklist applied to existing solutions:
- **S**ubstitute — What component can we swap?
- **C**ombine — Can two features merge?
- **A**dapt — What existing pattern can we borrow?
- **M**odify — What if we change the scale/scope?
- **P**ut to other use — Can an existing module serve this need?
- **E**liminate — What if we removed this requirement entirely?
- **R**everse — What if the data flow went the other direction?

### Worst Possible Idea
Deliberately generate terrible solutions. Then extract the kernel of insight
from each — often the inversion of a bad idea reveals a good one.
Best for: breaking creative blocks, surfacing unconsidered approaches.

### Wild Card Reframe
Generate at least one approach that fundamentally reframes the problem.
"What if we don't need real-time at all? What if eventual consistency
with optimistic UI is good enough?"
Best for: challenging the problem definition itself.

### 10x Thinking
"What if this needed to handle 10x the load / 10x the users / 10x the data?"
Forces architecturally sound solutions over quick hacks.
Best for: scalability-sensitive decisions.

## Convergent Methods (Narrow to Best Options)

### Weighted Scoring Matrix
Define 4-6 criteria (e.g., complexity, maintainability, performance, team
familiarity, time-to-ship). Weight each. Score each approach 1-5.
Multiply and sum. Highest score wins — but use as input, not gospel.

### Elimination Rounds
Remove approaches that fail any hard constraint (e.g., "must run on AWS",
"must support offline"). Remaining approaches enter detailed comparison.

### 2×2 Matrix
Plot approaches on two axes that matter most (e.g., complexity vs. flexibility,
build-time vs. run-time cost). Solutions in the ideal quadrant win.

### Pre-mortem
"It's 6 months from now and this approach failed. Why?"
Each approach gets a pre-mortem. The one with the mildest failure mode
(or the most recoverable failure) may be the safest choice.

### Reversibility Test
"If we pick this approach and it's wrong, how hard is it to switch?"
Prefer reversible decisions. Irreversible decisions (database schema,
public API contracts) deserve extra scrutiny.

## Problem-Framing Methods (Phase 1 Support)

### 5 Whys
Ask "why?" five times to drill past symptoms to root causes.
"Users want dark mode" → Why? → "They use the app at night" → Why? →
"They're checking notifications before sleep" → the real need might be
a simplified night view, not full theming.

### Jobs-to-be-Done (JTBD)
"When [situation], I want to [motivation], so I can [expected outcome]."
Reframe requirements as jobs the user is hiring the product to do.
Surfaces functional, emotional, and social dimensions.

### Stakeholder Mapping
Identify all parties affected by this change. For each:
- What do they need?
- What do they fear?
- What would make them block this?
- What would make them champion this?

### Assumption Surfacing
List every assumption behind each requirement. Rate each:
- Confidence: how sure are we this is true?
- Impact: how bad if this assumption is wrong?
High-impact, low-confidence assumptions become Phase 6 probe targets.

## Adversarial Methods (Phase 4 / Phase 7 Support)

### Orthogonal Conflict Detection
For every pair of requirements (REQ-A, REQ-B), ask:
1. Can both be fully satisfied simultaneously?
2. Do they compete for the same resource (time, memory, bandwidth, user attention)?
3. Does optimizing for A degrade B?
If yes to 2 or 3, they are non-orthogonal and need explicit priority ordering.

### Boundary Analysis
For every numeric constraint (latency, size, count), ask:
- What happens at exactly the boundary? (100ms when limit is 100ms)
- What happens at 2x the boundary? (200ms)
- What happens at 0? (empty input)
- What happens at MAX_INT? (overflow)

### Threat Modeling (STRIDE)
For security-relevant requirements:
- **S**poofing — Can an attacker impersonate a user?
- **T**ampering — Can data be modified in transit/storage?
- **R**epudiation — Can actions be denied after the fact?
- **I**nformation disclosure — Can secrets leak?
- **D**enial of service — Can the system be overwhelmed?
- **E**levation of privilege — Can a user gain unauthorized access?

### Chaos Scenarios
"What if the database goes down mid-operation?"
"What if two users perform the same action at the same millisecond?"
"What if the third-party API returns valid-looking but wrong data?"
Generate 5-10 chaos scenarios per critical feature.

## Method Selection Guide

| Problem Type | Recommended Divergent | Recommended Convergent |
|-------------|----------------------|----------------------|
| Greenfield architecture | First Principles, 10x Thinking | Weighted Scoring, Pre-mortem |
| Feature addition to existing system | SCAMPER, Analogy Transfer | Elimination Rounds, Reversibility |
| Performance optimization | Inversion, 10x Thinking | 2×2 Matrix, Boundary Analysis |
| User-facing design | JTBD, Wild Card Reframe | Stakeholder Mapping, Pre-mortem |
| Security-critical | Threat Modeling, Chaos Scenarios | Orthogonal Conflict, Elimination |
