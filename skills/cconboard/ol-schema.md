---
description: >-
  Onboarding Log (OL) YAML schema reference for /cconboard.
  Defines the structure of .devcompanion/onboard-logs/<scope>.yaml
---

# Onboarding Log Schema

The OL document tracks the entire onboarding process. It is written to `.devcompanion/onboard-logs/<scope>.yaml`.

## Full Schema

```yaml
ol_version: "1.0"
scope: "packages/core/src/"          # target path (relative to project root)
status: "phase-5-executing"          # current phase + substatus
created: "2026-05-15T10:30:00Z"
updated: "2026-05-15T11:45:00Z"
archive_path: "archive/2026-05-15T10-30-00/"
git_sha: "abc123def"

# Phase 1 output
inventory:
  total_files: 12
  total_functions: 47
  total_classes: 5
  files:
    - path: "src/parser.ts"
      functions: ["parseFile", "parseSource", "initParser"]
      line_count: 245

# Phase 2 output
diagnosis:
  classifications:
    pure: 18
    adapter: 12
    orchestrator: 3
    mixed: 14
  god_functions:
    - name: "processAll"
      file: "src/main.ts"
      line_count: 142
      responsibilities: ["validation", "transformation", "I/O"]
  side_effects:
    - function: "saveResult"
      file: "src/output.ts"
      effects: ["filesystem"]
    - function: "fetchData"
      file: "src/input.ts"
      effects: ["network", "env_var"]
  functions:
    - hash: "abc123"
      name: "parseFile"
      file: "src/parser.ts"
      category: "pure"
      why: "Transforms raw source text into structured AST"
      what: "Parses a source file and returns a ParsedModule"
      how: "Initializes tree-sitter, runs parse, walks AST nodes"
      side_effects: []
      hidden_dependencies: []

# Phase 3 output
characterization_tests:
  generated: 47
  passing: 44
  failing: 3
  failing_functions:
    - name: "parseConfig"
      file: "src/config.ts"
      error: "Cannot read property 'length' of null"

# Phase 4 output
restructure_plan:
  total_items: 23
  by_risk: { low: 14, medium: 7, high: 2 }
  items:
    - id: OB-001
      type: extract_function          # see types below
      risk: low                       # low | medium | high
      source_file: "src/utils.ts"
      source_function: "processData"
      target: "src/utils/data-processor.ts"
      reason: "God function (142 lines) with 3 responsibilities"
      status: pending                 # pending | completed | reverted | skipped
      depends_on: []                  # other OB-xxx IDs that must complete first

# Phase 5 output (populated as items execute)
execution_log:
  - id: OB-001
    executed_at: "2026-05-15T11:00:00Z"
    status: completed
    before_content: |
      function processData(input: string) {
        // 142 lines...
      }
    after_content: |
      function processData(input: string) {
        const parsed = parseRawInput(input);
        return transformResult(parsed);
      }
    char_test_status: pass
    log_message: "Extracted parseRawInput() and transformResult() from processData()"

# Phase 6 output
post_refactor_tests:
  generated: 47
  coverage_percent: 100
  all_passing: true

# Phase 7 output
verification:
  total_tests: 94                    # char + post-refactor
  passing: 94
  failing: 0
  report_path: "onboard-report.html"

# Phase 8 output
handoff:
  ecl_path: "docs/ecl/onboard-core.yaml"
  feature_guards_count: 12
  completed_at: "2026-05-15T12:00:00Z"

# Decisions made during onboarding (user confirmations for medium-risk)
decisions:
  - id: OB-DEC-001
    date: "2026-05-15T11:15:00Z"
    item_ref: OB-005
    decision: "Approved: split renderer.ts into renderer.ts + helpers.ts"
    rationale: "User confirmed after reviewing diff"
```

## Modification Types

| Type | Description |
|------|-------------|
| `add_types` | Add TypeScript type annotations |
| `add_docstring` | Add JSDoc documentation |
| `extract_function` | Pull code block into separate function |
| `move_file` | Relocate function to better file |
| `inject_dependency` | Replace hardcoded dep with parameter |
| `split_module` | Break large file into multiple |
| `change_api` | Modify public interface |
| `restructure` | Reorganize module architecture |

## Risk Levels

| Risk | Execution | Criteria |
|------|-----------|----------|
| `low` | Auto-execute, archive original | No runtime behavior change, no other files affected |
| `medium` | Show diff, wait for user confirm | Interface changes but impact is bounded and enumerable |
| `high` | Plan only, output as ECL item | Large/uncertain blast radius |

## Status Values

Format: `phase-<N>-<substatus>`

Examples:
- `phase-0-archiving`
- `phase-1-scanning`
- `phase-2-analyzing`
- `phase-3-generating-tests`
- `phase-4-planning`
- `phase-5-executing`
- `phase-5-waiting-confirmation` (medium-risk item pending)
- `phase-6-generating-tests`
- `phase-7-verifying`
- `phase-8-handoff`
- `completed`
