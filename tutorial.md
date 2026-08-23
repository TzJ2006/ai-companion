# AI Dev Companion — Tutorial

This tutorial walks through a complete workflow: from initializing the tool in a Python project to viewing an annotated HTML report of your changes.

## Prerequisites

```bash
cd ai-dev-companion
npm install
npm run build
```

Verify the build succeeded (no output = no errors):
```bash
npx tsc --build
```

## Step 1: Initialize in Your Project

Your target project must be a git repository with at least one commit.

```bash
# Example: create a demo project
mkdir /tmp/my-project && cd /tmp/my-project
git init

cat > math_utils.py << 'EOF'
def add(a: int, b: int) -> int:
    """Add two numbers."""
    return a + b

def multiply(a: int, b: int) -> int:
    """Multiply two numbers."""
    return a * b
EOF

git add -A && git commit -m "initial commit"
```

Now initialize AI Dev Companion:

```bash
node /path/to/ai-dev-companion/packages/cli/dist/main.js init -p /tmp/my-project
```

This creates:
```
/tmp/my-project/
├── .devcompanion/
│   ├── reviews/       ← review session files (JSON)
│   ├── history/       ← per-file change history (JSON)
│   └── index.json     ← global function index
└── .gitignore         ← updated with ".devcompanion/"
```

## Step 2: Make Some Changes

Edit your Python file — add a new function and modify an existing one:

```python
# math_utils.py (after editing)
def add(a: int, b: int) -> int:
    """Add two numbers."""
    if not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
        raise TypeError("Arguments must be numeric")
    return a + b

def multiply(a: int, b: int) -> int:
    """Multiply two numbers."""
    return a * b

def divide(a: float, b: float) -> float:
    """Divide a by b."""
    if b == 0:
        raise ValueError("Cannot divide by zero")
    return a / b
```

## Step 3: Record the Changes

```bash
node /path/to/ai-dev-companion/packages/cli/dist/main.js review \
  -p /tmp/my-project \
  --reason "Added input validation to add() and new divide() function"
```

Output:
```
Analyzing changes...
Review saved: /tmp/my-project/.devcompanion/reviews/2026-05-15T15-30-00-000Z.json
  2 changes recorded
  Files: math_utils.py
```

## Step 4: Generate HTML Report

```bash
node /path/to/ai-dev-companion/packages/cli/dist/main.js render \
  -p /tmp/my-project \
  --latest \
  -o /tmp/my-project/review.html
```

Open in browser:
```bash
open /tmp/my-project/review.html
```

The HTML report groups changes **by reason** into collapsible sections. Each
section shows:
- The reason for the change (and its source: context, user-provided, ...)
- The affected files, each with its function-level changes
- Per-function badges for the change type (add/modify/delete)
- Inline diffs of the old and new content

## Step 5: Query History

```bash
# Overview
node /path/to/ai-dev-companion/packages/cli/dist/main.js history -p /tmp/my-project

# Specific file
node /path/to/ai-dev-companion/packages/cli/dist/main.js history \
  -p /tmp/my-project math_utils.py

# List review sessions
node /path/to/ai-dev-companion/packages/cli/dist/main.js history \
  -p /tmp/my-project --list-sessions
```

## Step 6: Claude Code Hook Integration (Optional)

To auto-capture changes when Claude Code edits your Python or TypeScript files, add this to your `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "node /path/to/ai-dev-companion/packages/hook/dist/index.js" }
        ]
      }
    ]
  }
}
```

(There is also an optional PreToolUse guard hook, `packages/hook/dist/pre-tool-use.js`
with matcher `Edit|Write|Bash`, that enforces read-only mode while /ccplan is active.
`scripts/install.ts` sets both up for you.)

The hook writes events to `.devcompanion/queue/events.jsonl`. The daemon processes them asynchronously:

```bash
node /path/to/ai-dev-companion/packages/daemon/dist/index.js /tmp/my-project
```

## Understanding the Data Model

### Function Identity

Each function is identified by a stable hash that survives line-number changes:

```
hash = sha256(file_path + class_name + function_name + param_types)[0:16]
```

Example: `math_utils.py::add(a:int,b:int)` → `3ec02b024856ccc0`

This means renaming a parameter type creates a new identity (intentional — the contract changed).

### Storage Structure

```
.devcompanion/
├── reviews/
│   ├── 2026-05-15T15-30-00-000Z.json    ← full session with all changes
│   └── 2026-05-15T16-00-00-000Z.json
├── history/
│   └── math_utils.py.json               ← all changes to this file, grouped by function hash
└── index.json                            ← quick lookup: function_hash → file + last status
```

### Change Record Fields

| Field | Description |
|-------|-------------|
| `id` | Unique UUID for this change |
| `timestamp` | ISO 8601 timestamp |
| `file_path` | Relative path to the changed file |
| `function_hash` | Stable function identity (16 hex chars) |
| `function_name` | Human-readable function name |
| `class_name` | Parent class (null for module-level functions) |
| `change_type` | `add`, `modify`, `delete`, or `rename` |
| `reason` | Why the change was made |
| `reason_source` | `context` (from AI), `llm-inferred`, or `user-provided` |
| `old_content` | Removed lines |
| `new_content` | Added lines |
| `start_line` / `end_line` | Function location in the new file |
| `test_status` | `pending`, `pass`, `fail`, or `skipped` |
| `error_id` | Reference to a specific test failure |
| `session_id` | Groups changes from the same review session |

## Workflow Integration

### Typical Development Cycle

```
1. Write code (or let AI write it)
       │
       ▼
2. aidev review --reason "..."     ← records what changed and why
       │
       ▼
3. aidev render --latest           ← visualize in HTML
       │
       ▼
4. Run tests
       │
       ├── All pass → commit
       │
       └── Failure → aidev history <file>   ← trace which change broke it
                         │
                         ▼
                    Fix and repeat from step 1
```

### With Claude Code Hook (Automatic)

```
1. Claude Code edits your .py file
       │
       ▼
2. Hook fires → writes to queue (instant, <100ms)
       │
       ▼
3. Daemon picks up → computes diff → stores record
       │
       ▼
4. At any time: aidev render --latest    ← see what AI did
```

## Tips

- Use `--reason` every time you run `review` — future you will thank you
- The HTML report is fully self-contained (all CSS inline, no external dependencies) — share it via email/Slack
- `index.json` gives you a bird's-eye view of all tracked functions and their test status
- History files are plain JSON — you can `cat` or `jq` them directly
- If you move/rename a file, the history follows the file path (function hash changes for renames)

## Troubleshooting

**"No changes detected"**
- Make sure you have uncommitted changes (`git diff` should show something)
- The tool analyzes unstaged changes by default; use `--staged` for staged-only

**"Parser not initialized"**
- Ensure `tree-sitter-python` is installed: check `node_modules/tree-sitter-python/tree-sitter-python.wasm` exists

**HTML report is empty**
- Check that `.devcompanion/reviews/` has at least one JSON file
- Try `aidev history --list-sessions` to see what's stored
