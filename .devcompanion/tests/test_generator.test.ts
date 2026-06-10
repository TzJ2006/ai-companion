import { describe, it, expect } from "vitest";
import {
  buildTestPrompt,
  buildTestFilePath,
  parseTestResponse,
} from "../../packages/core/src/test-gen/generator.js";
import type { FunctionSignature, FunctionParam } from "@aidev/ast";
import type { ChangeRecord } from "@aidev/history";

const mockParam = (
  name: string,
  type: string | null = "str",
  default_value: string | null = null
): FunctionParam => ({
  name,
  type,
  default_value,
  is_args: false,
  is_kwargs: false,
});

const mockFunctionSignature = (
  overrides: Partial<FunctionSignature> = {}
): FunctionSignature => ({
  name: "example_function",
  params: [mockParam("arg1", "str"), mockParam("arg2", "int", "42")],
  return_type: "str",
  decorators: [],
  is_method: false,
  is_async: false,
  class_name: null,
  start_line: 1,
  end_line: 10,
  docstring: "Example function docstring.",
  ...overrides,
});

const mockChangeRecord = (
  overrides: Partial<ChangeRecord> = {}
): ChangeRecord => ({
  id: "change-1",
  timestamp: "2026-05-15T10:00:00Z",
  file_path: "/src/module.py",
  function_hash: "abc123",
  function_name: "example_function",
  class_name: null,
  change_type: "modify",
  reason: "Optimized function performance",
  reason_source: "llm-inferred",
  old_content: "def example_function(arg1, arg2=42): return arg1",
  new_content: "def example_function(arg1, arg2=42): return arg1.strip()",
  start_line: 1,
  end_line: 1,
  test_status: "pending",
  test_file: null,
  error_id: null,
  session_id: "session-1",
  ...overrides,
});

describe("buildTestPrompt", () => {
  it("should build a basic test prompt for a simple function", () => {
    const fn = mockFunctionSignature();
    const result = buildTestPrompt(fn, null, "normal");

    expect(typeof result).toBe("string");
    expect(result).toContain("Generate pytest test cases");
    expect(result).toContain("Function Signature");
    expect(result).toContain("def example_function");
    expect(result).toContain("arg1");
    expect(result).toContain("arg2");
    expect(result).toContain("Parameters");
    expect(result).toContain("Return Type");
    expect(result).toContain("str");
  });

  it("should include async keyword when function is async", () => {
    const fn = mockFunctionSignature({ is_async: true });
    const result = buildTestPrompt(fn, null, "normal");

    expect(result).toContain("async def example_function");
  });

  it("should include class name in signature when present", () => {
    const fn = mockFunctionSignature({
      class_name: "MyClass",
      is_method: true,
    });
    const result = buildTestPrompt(fn, null, "normal");

    expect(result).toContain("MyClass.example_function");
  });

  it("should include docstring when present", () => {
    const docstring = "This function does something important.";
    const fn = mockFunctionSignature({ docstring });
    const result = buildTestPrompt(fn, null, "normal");

    expect(result).toContain("Docstring");
    expect(result).toContain(docstring);
  });

  it("should not include docstring section when docstring is null", () => {
    const fn = mockFunctionSignature({ docstring: null });
    const result = buildTestPrompt(fn, null, "normal");

    expect(result).not.toContain("## Docstring");
  });

  it("should include change context when ChangeRecord is provided", () => {
    const fn = mockFunctionSignature();
    const change = mockChangeRecord({
      reason: "Bug fix: handle null inputs",
      new_content: "def example_function(arg1, arg2=42):\n  if arg1 is None:\n    return ''\n  return arg1",
    });
    const result = buildTestPrompt(fn, change, "normal");

    expect(result).toContain("Change Context");
    expect(result).toContain("Bug fix: handle null inputs");
    expect(result).toContain("New code:");
    expect(result).toContain("```python");
  });

  it("should not include change context when change is null", () => {
    const fn = mockFunctionSignature();
    const result = buildTestPrompt(fn, null, "normal");

    expect(result).not.toContain("Change Context");
  });

  it("should use normal test type instructions for normal tests", () => {
    const fn = mockFunctionSignature();
    const result = buildTestPrompt(fn, null, "normal");

    expect(result).toContain(
      "Write 3-5 test cases covering the happy path and typical usage patterns."
    );
  });

  it("should use edge case test type instructions for edge_case tests", () => {
    const fn = mockFunctionSignature();
    const result = buildTestPrompt(fn, null, "edge_case");

    expect(result).toContain(
      "Write 3-5 test cases covering edge cases: empty inputs, None values, type errors, boundary conditions, large inputs."
    );
  });

  it("should include parameters with default values formatted correctly", () => {
    const fn = mockFunctionSignature({
      params: [
        mockParam("name", "str", null),
        mockParam("count", "int", "10"),
        mockParam("enabled", "bool", "True"),
      ],
    });
    const result = buildTestPrompt(fn, null, "normal");

    expect(result).toContain("- name: str");
    expect(result).toContain("- count: int = 10");
    expect(result).toContain("- enabled: bool = True");
  });

  it("should handle functions with no parameters", () => {
    const fn = mockFunctionSignature({ params: [] });
    const result = buildTestPrompt(fn, null, "normal");

    expect(result).toContain("def example_function()");
  });

  it("should handle functions with no return type", () => {
    const fn = mockFunctionSignature({ return_type: null });
    const result = buildTestPrompt(fn, null, "normal");

    expect(result).toContain("Return Type");
    expect(result).toContain("Not specified");
  });

  it("should handle parameter types that are null", () => {
    const fn = mockFunctionSignature({
      params: [mockParam("arg1", null)],
    });
    const result = buildTestPrompt(fn, null, "normal");

    expect(result).toContain("- arg1: Any");
  });

  it("should include instructions for pytest output", () => {
    const fn = mockFunctionSignature();
    const result = buildTestPrompt(fn, null, "normal");

    expect(result).toContain("Output ONLY valid Python test code using pytest");
    expect(result).toContain("Include necessary imports");
    expect(result).toContain("test_");
  });
});

describe("buildTestFilePath", () => {
  it("should build correct test file path for function without class", () => {
    const config = {
      llm_provider: "claude" as const,
      test_framework: "pytest" as const,
      output_dir: "/tests"
    };
    const fn = mockFunctionSignature({ name: "my_function" });
    const result = buildTestFilePath(config, fn, "/src/utils.py");

    expect(result).toBe("/tests/test_utils_my_function.py");
  });

  it("should build correct test file path for class method", () => {
    const config = {
      llm_provider: "claude" as const,
      test_framework: "pytest" as const,
      output_dir: "/tests"
    };
    const fn = mockFunctionSignature({
      name: "process",
      class_name: "DataProcessor",
    });
    const result = buildTestFilePath(config, fn, "/src/data.py");

    expect(result).toBe("/tests/test_data_DataProcessor_process.py");
  });

  it("should handle source file path with multiple directory levels", () => {
    const config = {
      llm_provider: "claude" as const,
      test_framework: "pytest" as const,
      output_dir: "/project/tests"
    };
    const fn = mockFunctionSignature({ name: "calculate" });
    const result = buildTestFilePath(
      config,
      fn,
      "/project/src/module/helper.py"
    );

    expect(result).toBe("/project/tests/test_helper_calculate.py");
  });

  it("should handle source file path without .py extension", () => {
    const config = {
      llm_provider: "claude" as const,
      test_framework: "pytest" as const,
      output_dir: "/tests"
    };
    const fn = mockFunctionSignature();
    const result = buildTestFilePath(config, fn, "/src/module");

    expect(result).toContain("test_module_");
  });

  it("should use 'module' as default file name when unable to extract", () => {
    const config = {
      llm_provider: "claude" as const,
      test_framework: "pytest" as const,
      output_dir: "/tests"
    };
    const fn = mockFunctionSignature();
    const result = buildTestFilePath(config, fn, "");

    expect(result).toBe("/tests/test__example_function.py");
  });

  it("should handle forward slashes in path", () => {
    const config = {
      llm_provider: "claude" as const,
      test_framework: "pytest" as const,
      output_dir: "C:/project/tests"
    };
    const fn = mockFunctionSignature({ name: "validate" });
    const result = buildTestFilePath(
      config,
      fn,
      "C:/project/src/validators.py"
    );

    expect(result).toContain("test_validators_validate.py");
  });
});

describe("parseTestResponse", () => {
  it("should extract code from markdown code block with python", () => {
    const response = `Here's the test code:

\`\`\`python
import pytest

def test_example():
    assert True
\`\`\`

This is your test!`;

    const result = parseTestResponse(response);

    expect(result).toBe("import pytest\n\ndef test_example():\n    assert True");
  });

  it("should return trimmed response if no code block found but contains import and test", () => {
    const response = `
import pytest
def test_something():
    pass
`;

    const result = parseTestResponse(response);

    expect(result).toBe("import pytest\ndef test_something():\n    pass");
  });

  it("should return trimmed response if no code block found and no import/test", () => {
    const response = "  Some random text  ";

    const result = parseTestResponse(response);

    expect(result).toBe("Some random text");
  });

  it("should handle multiple code blocks and extract first python block", () => {
    const response = `
\`\`\`python
def test_first():
    pass
\`\`\`

Some text

\`\`\`python
def test_second():
    pass
\`\`\`
`;

    const result = parseTestResponse(response);

    expect(result).toContain("def test_first():");
    expect(result).not.toContain("def test_second():");
  });

  it("should handle code block with multiline content", () => {
    const response = `\`\`\`python
import pytest
from module import function_to_test

def test_basic():
    result = function_to_test(1, 2)
    assert result == 3

def test_edge_case():
    with pytest.raises(ValueError):
        function_to_test(None, 2)
\`\`\``;

    const result = parseTestResponse(response);

    expect(result).toContain("import pytest");
    expect(result).toContain("def test_basic():");
    expect(result).toContain("def test_edge_case():");
  });

  it("should return plain response if it has import and test but no code block", () => {
    const response = `import unittest

def test_my_func():
    assert 1 == 1`;

    const result = parseTestResponse(response);

    expect(result).toBe("import unittest\n\ndef test_my_func():\n    assert 1 == 1");
  });

  it("should trim whitespace from extracted code", () => {
    const response = `\`\`\`python

def test_trimmed():
    pass

\`\`\``;

    const result = parseTestResponse(response);

    expect(result).toBe("def test_trimmed():\n    pass");
  });

  it("should handle empty code block", () => {
    const response = `\`\`\`python
\`\`\``;

    const result = parseTestResponse(response);

    expect(result).toBe("");
  });

  it("should handle response with code block but no leading text", () => {
    const response = `\`\`\`python
def test_no_prefix():
    assert True
\`\`\``;

    const result = parseTestResponse(response);

    expect(result).toBe("def test_no_prefix():\n    assert True");
  });
});
