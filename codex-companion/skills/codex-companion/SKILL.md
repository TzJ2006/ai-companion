---
name: codex-companion
description: Use Codex Companion to onboard a codebase, align and decompose a new idea, create a researched Idea Graph plan, implement approved nodes test-first in topological order, debug contract drift, render the project graph, or record project changes. Trigger when the user mentions Codex Companion, Idea Graph, idea nodes, modular project understanding, onboarding, or asks to trace why code exists and how it is verified.
---

# Codex Companion

Turn intent into a durable graph of reviewable idea contracts. Keep all state in the target
project's `.codex-companion/` directory (or `.codex-companion.codex/` if the plain name is
already owned by another tool). Do not read, write, migrate, or depend on ECL,
`.devcompanion/`, `cc*` skills, or Claude Code files unless the user explicitly requests an import.

## Locate the tooling

Resolve `../../scripts/companion.py` relative to this `SKILL.md`, then use its absolute path for
every command. Use an available Python 3 interpreter (`python3`, or commonly `python` on Windows).
The CLI uses only Python's standard library.

Before any workflow:

1. Resolve the target project root. Prefer the Git root containing the user's subject files.
2. If both `.codex-companion/project.json` and `.codex-companion.codex/project.json` are absent,
   run `companion.py init --root <root>`. The CLI claims the unsuffixed name when free and uses the
   sticky `.codex` suffix on collision; never rename or merge another agent's files.
3. Run `companion.py status --root <root>` and inspect existing nodes before creating new ones.
4. Read [workflows.md](references/workflows.md), then read only the section for the requested mode.
5. Read [idea-graph-v1.md](references/idea-graph-v1.md) before creating or editing nodes.

This skill selects and explains the workflow; the CLI and trusted hooks enforce it. If strict mode
is configured but the hooks are not trusted, tell the user that enforcement is inactive and do not
claim the harness guarantees were applied.

## Choose exactly one mode

- **Onboard**: understand an existing project and construct its initial graph.
- **Discuss**: align a new idea's what, expected result, and why; do not plan yet.
- **Plan**: decompose an aligned idea, research reuse, design verification, and make a weekly plan.
- **Build**: implement only user-approved nodes, test-first, in topological order.
- **Debug**: determine whether implementation drifted from the node or the node is wrong.
- **Graph**: validate and render the current graph without changing product code.
- **Record**: inspect or add audit events without changing product code.

If the request spans modes, follow the lifecycle order and stop at every user-review gate. Never
silently cross from discussion to planning or from planning to implementation.

## Non-negotiable gates

- Prefer Plan mode when the client exposes it. Otherwise remain read-only during Discuss and Plan,
  except for artifacts in the active `.codex-companion/` or `.codex-companion.codex/` state.
- For Discuss, ask and confirm exactly three high-level questions: **what are we making, what result
  should be observable, and why does it matter?** Use `request-approval --gate intent --node <id>`
  and stop after presenting the exact challenge. Never answer that challenge yourself.
- For Plan, first show the decomposed name-only graph and stop for approval. Only then complete local
  research, web research, reuse decisions, verification designs, and weekly plans; render again and
  stop for approval. Use snapshot-bound `decomposition` and `plan` approval challenges.
- Reuse has first priority. Search the current repository before the web; when web research is
  required, prefer primary/official sources. Record sources and explicit reuse/reject reasons.
- For Build, activate one approved node and set it to `implementing`. Add files under each check's
  `test_paths`, run `run-check <node> <check> --phase red`, then change only approved
  `implementation.target_paths`. Run the green phase, update exact code line references, call
  `record --node <id>`, and only then set the node to `done`.
- Never claim a node is done when any verification item is not `passed`.
- Never claim onboarding covered the whole project while `coverage.json` has unreviewed text files.
- Append a semantic log event after every meaningful code, document, idea, dependency, test, or
  status change. The hook records touched files; the semantic event records what changed and why.
- Never edit `status`, approval/runtime files, active state, logs, coverage, or rendered reports
  directly. Use the CLI. In strict mode the hooks reject those writes.

## Finish every mode

Run:

```text
python <companion.py> validate --root <root>
python <companion.py> render --root <root>
```

After a completed active node, run `deactivate` only after the fresh render. When waiting for a user
challenge, stop normally; the harness deliberately permits that review boundary.

Report the current review gate, nodes changed, verification evidence, remaining gaps, and the
absolute path to the generated HTML. Do not mark approval on the user's behalf.
