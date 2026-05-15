#!/bin/bash
# Enhance test skeletons using Claude CLI
# Usage: ./scripts/enhance-tests.sh [test-file...]

PROJECT_ROOT="/Users/tongtongtot/Desktop/algorithms/ai-dev-companion"
TEST_DIR="$PROJECT_ROOT/.devcompanion/tests"

# Map test filename -> source file
get_source_file() {
  local test_file="$1"
  local base=$(echo "$test_file" | sed 's/^test_//' | sed 's/\.test\.ts$//')

  # Extract module name (before first _) and function name (rest)
  local module=$(echo "$base" | sed 's/_.*//')

  # Search for the source file
  local found=$(find "$PROJECT_ROOT/packages" -name "${module}.ts" -not -path "*/dist/*" -not -path "*/node_modules/*" | head -1)
  echo "$found"
}

enhance_file() {
  local test_path="$1"
  local test_file=$(basename "$test_path")
  local source_file=$(get_source_file "$test_file")

  if [ -z "$source_file" ] || [ ! -f "$source_file" ]; then
    echo "  Skip (no source found): $test_file"
    return
  fi

  echo "  Enhancing: $test_file (source: $(basename $source_file))"

  local skeleton=$(cat "$test_path")
  local source=$(cat "$source_file")

  local prompt="You are a senior TypeScript test engineer. Given this source code and test skeleton, produce a complete, runnable vitest test file with meaningful assertions.

## Source Code ($(basename $source_file)):
\`\`\`typescript
$source
\`\`\`

## Test Skeleton:
\`\`\`typescript
$skeleton
\`\`\`

## Rules:
- Use vitest (describe, it, expect, vi for mocks)
- Fix import paths: use relative paths from .devcompanion/tests/ to packages/
- For functions that need filesystem or Parser init, mock appropriately
- Replace placeholder values with realistic test data
- Add edge case tests where obvious
- Keep tests focused and clear
- Output ONLY the complete test file, no markdown fences, no explanation"

  local result=$(echo "$prompt" | claude -p 2>/dev/null)

  if echo "$result" | grep -q "describe("; then
    # Strip markdown fences if present
    local clean=$(echo "$result" | sed '/^```typescript$/d' | sed '/^```ts$/d' | sed '/^```$/d')
    echo "$clean" > "$test_path"
    echo "    ✓ Enhanced successfully"
  else
    echo "    ✗ LLM output not valid, keeping skeleton"
  fi
}

# If specific files passed as args, use those; otherwise use key files
if [ $# -gt 0 ]; then
  FILES="$@"
else
  FILES=(
    "$TEST_DIR/test_identity_computeFunctionIdentity.test.ts"
    "$TEST_DIR/test_multi-lang_getSupportedExtensions.test.ts"
    "$TEST_DIR/test_multi-lang_parseFileAuto.test.ts"
    "$TEST_DIR/test_parser_parseSource.test.ts"
    "$TEST_DIR/test_ts-parser_parseTsFile.test.ts"
    "$TEST_DIR/test_annotator_annotateChanges.test.ts"
    "$TEST_DIR/test_parser_parseUnifiedDiff.test.ts"
    "$TEST_DIR/test_store_HistoryStore.test.ts"
    "$TEST_DIR/test_renderer_renderSessionToHtml.test.ts"
  )
fi

echo "Enhancing test files with Claude CLI..."
echo ""

for f in "${FILES[@]}"; do
  if [ -f "$f" ]; then
    enhance_file "$f"
  fi
done

echo ""
echo "Done."
