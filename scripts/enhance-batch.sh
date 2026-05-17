#!/bin/bash
# Batch enhance test skeletons using claude CLI (parallel + haiku)
# Processes failed TS tests (excluding Python/scripts)
# Uses background jobs instead of xargs -P to avoid Windows fork issues

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_DIR="$PROJECT_ROOT/.devcompanion/tests"
PARALLEL=${PARALLEL:-16}
RESULT_DIR=$(mktemp -d)

enhance_test() {
  local test_path="$1"
  local test_file=$(basename "$test_path")
  local base="${test_file#test_}"
  base="${base%.test.ts}"
  local module="${base%_*}"

  # Find source file
  local source_file=$(find "$PROJECT_ROOT/packages" -name "${module}.ts" -not -path "*/dist/*" -not -path "*/node_modules/*" 2>/dev/null | head -1)
  if [ -z "$source_file" ]; then
    source_file=$(find "$PROJECT_ROOT/packages" -name "${module}.ts" -not -path "*/dist/*" 2>/dev/null | head -1)
  fi

  if [ -z "$source_file" ] || [ ! -f "$source_file" ]; then
    echo "SKIP $test_file" >> "$RESULT_DIR/log.txt"
    return
  fi

  local skeleton=$(cat "$test_path")
  local source=$(cat "$source_file")
  local rel_source="${source_file#$PROJECT_ROOT/}"

  local prompt="You are a senior TypeScript test engineer. Given this source code and test skeleton, produce a complete, runnable vitest test file with meaningful assertions.

## Source Code ($rel_source):
\`\`\`typescript
$source
\`\`\`

## Test Skeleton:
\`\`\`typescript
$skeleton
\`\`\`

## Rules:
- Use vitest (describe, it, expect, vi for mocks)
- Import path must be: \"../../${rel_source%.ts}.js\" (relative from .devcompanion/tests/ to source)
- For functions that need Parser init (tree-sitter), mock the parser or skip those tests with it.skip
- For functions needing filesystem access, use vi.mock or provide inline test data
- Replace placeholder values with realistic test data
- Add edge case tests where obvious
- Keep tests focused and clear
- Output ONLY the complete test file, no markdown fences, no explanation"

  local result=$(echo "$prompt" | claude -p --bare --output-format text --model haiku 2>/dev/null)

  if echo "$result" | grep -q "describe("; then
    local clean=$(echo "$result" | sed '/^```[a-z]*$/d' | sed '/^```$/d')
    echo "$clean" > "$test_path"
    echo "OK $test_file" >> "$RESULT_DIR/log.txt"
  else
    echo "FAIL $test_file" >> "$RESULT_DIR/log.txt"
  fi
}

# Get list of test files (excluding Python and scripts)
mapfile -t FILES < <(ls "$TEST_DIR"/test_*.test.ts 2>/dev/null | grep -v "guard-check" | grep -v "collect-report" | grep -v "generate-report" | grep -v "enhanceTests" | grep -v "test_add.test.ts")

TOTAL=${#FILES[@]}
echo "Enhancing $TOTAL test files with Claude Haiku ($PARALLEL parallel workers)..."
echo "Results log: $RESULT_DIR/log.txt"
echo ""

# Run in batches of $PARALLEL
RUNNING=0
for f in "${FILES[@]}"; do
  enhance_test "$f" &
  ((RUNNING++))
  if ((RUNNING >= PARALLEL)); then
    wait -n 2>/dev/null || wait
    ((RUNNING--))
  fi
done
wait

echo ""
echo "=== Results ==="
OK=$(grep -c "^OK" "$RESULT_DIR/log.txt" 2>/dev/null || echo 0)
FAIL=$(grep -c "^FAIL" "$RESULT_DIR/log.txt" 2>/dev/null || echo 0)
SKIP=$(grep -c "^SKIP" "$RESULT_DIR/log.txt" 2>/dev/null || echo 0)
echo "Enhanced: $OK | Failed: $FAIL | Skipped: $SKIP | Total: $TOTAL"
echo ""
echo "Done. Run: npx vitest run"
