---
description: "Debug — first check the code against what the idea says, then question the idea itself."
---

Read `claude-companion/FORMAT.md` first.

## Arguments

$ARGUMENTS

An idea id, a failing test path, or nothing (then find what is `blocked` or
failing and ask which to work on).

## What you are doing

Two steps, strictly in this order. The order is the whole method: **most bugs
are the code disagreeing with the idea, and the rest are the idea being wrong.**
Never jump to step 2 while step 1 has findings.

---

## Step 1 — Does the code match the idea?

```bash
npx tsx claude-companion/ideas.ts show <id>
```

Read the code at every entry in `code`. Then compare it, line by line, against
what the idea says it should be:

| Check against | Question |
|---|---|
| `what` | Does this code do that thing, or something adjacent? |
| `how` | Is it built the way the idea says it is built? |
| `why_this_way` | Was that rationale actually followed, or worked around? |
| `expected` | Would this code produce that result? |
| `needs` | Does it depend on something not listed as a prerequisite? |

**Every inconsistency gets a reference.** Not "the error handling is off" but:

```
ideas/graph.yaml  I-014.how       "缓存第一次命中的结果"
src/resolver.ts:41-53              no cache — resolves on every call
→ 文档说要缓存，实现没有。
```

File, line range, what the idea says, what the code does, one line on the gap.
A finding without a line reference is not a finding.

Then **stop and show the human the full list.** The list reaches the human as a
plain-text message that **ends your turn** — content written just before a tool
call may never be shown. Ask which side is wrong in that same message, and wait
for the reply. Per finding, the two possible answers:

- **The code is wrong** → fix the code to match the idea.
- **The idea is stale** → update `ideas/graph.yaml` and log it. The code was
  right; the record fell behind.

Do not start fixing on your own judgement of which side is right. You are the
one who cannot tell — that is exactly why this step ends in a review.

After the approved fixes: run `verify.command`, then the wider suite. If it now
passes, mark it and you are finished — most of the time, you will be.

---

## Step 2 — Then the idea itself may be wrong

Only when step 1 found nothing, or the fixes did not help. The code faithfully
implements the idea and the result is still not what anyone wanted. So the idea
is what needs changing.

Show the human, concretely:

1. **The inputs** — what actually goes in. Real values, from a real run.
2. **The outputs** — what actually comes out. Real values, not a description.
3. **`expected`** — what the idea said should come out.
4. **The other seven answers** — the whole idea, so the human can see which one
   is wrong rather than guessing.
5. **Your reading** of where the idea breaks: usually `expected` was never
   achievable, `how` cannot produce it, or `why` describes a problem this idea
   was never going to solve.

Instrument the code to get real values if you need to — and remove that
instrumentation before you finish. Never show made-up example values here; the
whole point of this step is that the human is looking at reality.

Then the human revises the idea. You edit `ideas/graph.yaml` to what they say,
log the revision, and hand back to `/ccbuild` — which will rewrite the test
first, because `verify` changed too.

---

## Rules

1. **Never edit a test to make it pass.** The test is question 7. If it is
   wrong, the idea is wrong, and that is step 2, with a human.
2. **One fix at a time, verified separately.** A batch of fixes that passes
   tells you nothing about which one worked.
3. **Three attempts, then stop.** Set the idea `blocked`, write what you tried
   and why each failed, and hand it back. Attempt four is where confident
   nonsense gets committed.
4. **Remove your instrumentation.** `git diff` before you finish.
5. **A fix that breaks another idea is not a fix.** Run the wider suite.

## Recording

Append to `ideas/log.md`: date, `ccfix`, the idea, whether it was step 1 (code
wrong / idea stale) or step 2 (idea wrong), the root cause in one line, and what
changed. Also append a `log:` entry to the idea itself — the reason belongs next
to the idea, where the next person will actually read it.
