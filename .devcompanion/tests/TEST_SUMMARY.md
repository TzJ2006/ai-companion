# Test File Summary: inferMockValue

## File Location
`.devcompanion/tests/ts-generator.inferMockValue.test.ts`

## Test Coverage

### Total Test Cases: 70 tests organized into 7 test suites

#### 1. **Type-based Inference (21 tests)**
   - String type handling (lowercase, uppercase, with spaces)
   - Numeric types (number, int, float)
   - Boolean types (boolean, bool)
   - Array types (string[], number[], array<string>, array<number>, generic Array)
   - Container types (Map, Record)
   - Promise/async types with unwrapping
   - Null/undefined/void special types
   - Whitespace handling

#### 2. **Name-based Inference (30 tests)**
   Tests inferring mock values from parameter names when type is null:
   - Path keywords: filePath, fileName, directory
   - Name keywords: name, label, title
   - ID keywords: id, hash
   - Count keywords: count, numItems, index, limit
   - Boolean keywords: flag, enabled, active
   - Object keywords: options, config, opts
   - Array keywords: items, list, entries
   - Callback keywords: callback, fn, handler
   - Content keywords: source, content, text

#### 3. **Fallback Behavior (2 tests)**
   - Unknown parameter names without type → TODO comment
   - Unknown types → TODO comment with parameter name

#### 4. **Case Insensitivity & Whitespace (4 tests)**
   - Uppercase types (STRING)
   - Mixed case types (BoOlEaN)
   - Whitespace stripping from type names
   - Internal spaces in generic types

#### 5. **Edge Cases (7 tests)**
   - Empty string parameter names
   - Special characters in names
   - Very long parameter names
   - Type priority over name
   - Nested generic types (Promise<string[]>)
   - Non-throwing behavior
   - Return type consistency

#### 6. **Real-world Patterns (7 tests)**
   - userId with string type
   - getData callback function
   - isEnabled boolean flag
   - configPath file path
   - itemList array
   - errorHandler callback
   - sourceContent text field

## Key Testing Strategies

### Comprehensive Type Coverage
The function `inferMockValue` handles:
- Primitive types (string, number, boolean)
- Collection types (arrays, objects, maps)
- Async types (Promise unwrapping)
- Special types (void, null, undefined)
- Generic/parameterized types

### Name-based Heuristics
Tests verify the function's smart naming heuristics that generate appropriate mock values based on parameter naming conventions:
- Path-related keywords suggest "/tmp/test"
- Boolean-related keywords suggest "true"
- ID-related keywords suggest "abc123"
- Handler/callback keywords suggest "() => {}"
- etc.

### Type Priority
Tests confirm that explicit type annotations take priority over name-based inference when both are available.

### Robustness
Tests ensure the function:
- Handles case variations and whitespace
- Provides meaningful TODO comments for unknown cases
- Always returns strings (since values are code snippets)
- Doesn't throw on valid inputs

## Assertions Used

- `expect(result).toBe()` - Exact string matching
- `expect(result).toContain()` - Partial string matching
- `expect(typeof result).toBe("string")` - Type verification
- `expect(result).toEqual()` - Deep equality
- `expect(() => ...).not.toThrow()` - Error handling

## Running the Tests

```bash
npm run test -- ts-generator.inferMockValue.test.ts
```

Or with vitest:

```bash
npx vitest .devcompanion/tests/ts-generator.inferMockValue.test.ts
```
