import { describe, it, expect, beforeEach } from "vitest";
import {
  buildTestPrompt,
  buildTestFilePath,
  parseTestResponse,
  TestGenerationConfig,
} from "../../packages/core/src/test-gen/generator.js";
import type { FunctionSignature } from "@aidev/ast";
import type { ChangeRecord } from "@aidev/history";

describe("test-gen/generator", () => {
  let mockFunctionSignature: FunctionSignature;
  let mockChangeRecord: ChangeRecord;
  let mockConfig: TestGenerationConfig;

  beforeEach(() => {
    mockFunctionSignature = {
      name: "calculate_sum",
      params: [
        {
          name: "numbers",
          type: "List[int]",
          default_value: null,
          is_args: false,
          is_kwargs: false,
        },
        {
          name: "offset",
          type: "int",
          default_value: "0",
          is_args: false,
          is_kwargs: false,
        },
      ],
      return_type: "int",
      decorators: [],
      is_method: false,
      is_async: false,
      class_name: null,
      start_line: 10,
      end_line: 20,
      docstring: "Calculates the sum of numbers with an optional offset.",
    };

    mockChangeRecord = {
      id: "change-001",
      timestamp: "2026-05-15T10:00:00Z",
      file_path: "src/utils.py",
      function_hash: "abc123def456",
      function_name: "calculate_sum",
      class_name: null,
      change_type: "modify",
      reason: "Added offset parameter for flexibility",
      reason_source: "llm-inferred",
      old_content: "def calculate_sum(numbers):\n    return sum(numbers)",
      new_content: "def calculate_sum(numbers, offset=0):\n    return sum(numbers) + offset",
      start_line: 10,
      end_line: 20,
      test_status: "pending",
      test_file: null,
      error_id: null,
      session_id: "session-001",
    };

    mockConfig = {
      llm_provider: "claude",
      model: "claude-3-sonnet-20240229",
      api_key: "test-key",
      test_framework: "pytest",
      output_dir: "/tests",
    };
  });

  describe("buildTestPrompt", () => {
    it("should generate a prompt with normal test type", () => {
      const prompt = buildTestPrompt(mockFunctionSignature, null, "normal");

      expect(prompt).toContain("Generate pytest test cases");
      expect(prompt).toContain("calculate_sum");
      expect(prompt).toContain("def calculate_sum(numbers, offset)");
      expect(prompt).toContain("int");
      expect(prompt).toContain("Write 3-5 test cases covering the happy path");
      expect(prompt).toContain("Calculates the sum of numbers with an optional offset.");
    });

    it("should generate a prompt with edge_case test type", () => {
      const prompt = buildTestPrompt(mockFunctionSignature, null, "edge_case");

      expect(prompt).toContain("Write 3-5 test cases covering edge cases");
      expect(prompt).toContain("empty inputs");
      expect(prompt).toContain("None values");
      expect(prompt).toContain("type errors");
      expect(prompt).toContain("boundary conditions");
      expect(prompt).toContain("large inputs");
    });

    it("should include parameter descriptions", () => {
      const prompt = buildTestPrompt(mockFunctionSignature, null, "normal");

      expect(prompt).toContain("- numbers: List[int]");
      expect(prompt).toContain("- offset: int = 0");
    });

    it("should include change context when ChangeRecord is provided", () => {
      const prompt = buildTestPrompt(mockFunctionSignature, mockChangeRecord, "normal");

      expect(prompt).toContain("## Change Context");
      expect(prompt).toContain("Added offset parameter for flexibility");
    });

    it("should omit change context when ChangeRecord is null", () => {
      const prompt = buildTestPrompt(mockFunctionSignature, null, "normal");

      expect(prompt).not.toContain("## Change Context");
    });

    it("should handle async functions", () => {
      const asyncFunc: FunctionSignature = {
        ...mockFunctionSignature,
        is_async: true,
      };
      const prompt = buildTestPrompt(asyncFunc, null, "normal");

      expect(prompt).toContain("async def");
    });

    it("should handle class methods", () => {
      const methodFunc: FunctionSignature = {
        ...mockFunctionSignature,
        class_name: "Calculator",
      };
      const prompt = buildTestPrompt(methodFunc, null, "normal");

      expect(prompt).toContain("Calculator.calculate_sum");
    });

    it("should handle functions without return type", () => {
      const noReturnFunc: FunctionSignature = {
        ...mockFunctionSignature,
        return_type: null,
      };
      const prompt = buildTestPrompt(noReturnFunc, null, "normal");

      expect(prompt).toContain("Not specified");
    });

    it("should handle functions without docstring", () => {
      const noDocFunc: FunctionSignature = {
        ...mockFunctionSignature,
        docstring: null,
      };
      const prompt = buildTestPrompt(noDocFunc, null, "normal");

      expect(prompt).not.toContain("## Docstring");
    });

    it("should handle functions with no parameters", () => {
      const noParamFunc: FunctionSignature = {
        ...mockFunctionSignature,
        params: [],
      };
      const prompt = buildTestPrompt(noParamFunc, null, "normal");

      expect(prompt).toContain("def calculate_sum()");
    });

    it("should format parameters without default values", () => {
      const singleParamFunc: FunctionSignature = {
        ...mockFunctionSignature,
        params: [
          {
            name: "value",
            type: "str",
            default_value: null,
            is_args: false,
            is_kwargs: false,
          },
        ],
      };
      const prompt = buildTestPrompt(singleParamFunc, null, "normal");

      expect(prompt).toContain("- value: str");
    });
  });

  describe("buildTestFilePath", () => {
    it("should build correct path for standalone function", () => {
      const path = buildTestFilePath(mockConfig, mockFunctionSignature, "utils.py");

      expect(path).toBe("/tests/test_utils_calculate_sum.py");
    });

    it("should build correct path for class method", () => {
      const methodFunc: FunctionSignature = {
        ...mockFunctionSignature,
        class_name: "Calculator",
      };
      const path = buildTestFilePath(mockConfig, methodFunc, "utils.py");

      expect(path).toBe("/tests/test_utils_Calculator_calculate_sum.py");
    });

    it("should handle full file paths with subdirectories", () => {
      const path = buildTestFilePath(mockConfig, mockFunctionSignature, "src/utils.py");

      expect(path).toBe("/tests/test_utils_calculate_sum.py");
    });

    it("should handle file paths with multiple extensions", () => {
      const path = buildTestFilePath(mockConfig, mockFunctionSignature, "src/helpers.py");

      expect(path).toBe("/tests/test_helpers_calculate_sum.py");
    });

    it("should use empty module name when empty path provided", () => {
      const path = buildTestFilePath(mockConfig, mockFunctionSignature, "");

      expect(path).toContain("test__calculate_sum.py");
    });

    it("should preserve output directory configuration", () => {
      const customConfig: TestGenerationConfig = {
        ...mockConfig,
        output_dir: "/custom/test/dir",
      };
      const path = buildTestFilePath(customConfig, mockFunctionSignature, "utils.py");

      expect(path).toBe("/custom/test/dir/test_utils_calculate_sum.py");
    });

    it("should handle paths with forward slashes", () => {
      const path = buildTestFilePath(
        mockConfig,
        mockFunctionSignature,
        "src/modules/utils.py"
      );

      expect(path).toBe("/tests/test_utils_calculate_sum.py");
    });

    it("should handle multiple underscores in function names", () => {
      const underscoreFn: FunctionSignature = {
        ...mockFunctionSignature,
        name: "calculate_weighted_sum_value",
      };
      const path = buildTestFilePath(mockConfig, underscoreFn, "utils.py");

      expect(path).toBe("/tests/test_utils_calculate_weighted_sum_value.py");
    });
  });

  describe("parseTestResponse", () => {
    it("should extract code from markdown code block", () => {
      const response = `Here's the test code:

\`\`\`python
import pytest

def test_calculate_sum():
    assert 1 + 1 == 2
\`\`\`

That's it!`;

      const result = parseTestResponse(response);

      expect(result).toContain("import pytest");
      expect(result).toContain("def test_calculate_sum():");
      expect(result).toContain("assert 1 + 1 == 2");
      expect(result).not.toContain("```");
    });

    it("should extract raw code without markdown if it contains imports and test_", () => {
      const response = `import pytest

def test_example():
    assert True`;

      const result = parseTestResponse(response);

      expect(result).toContain("import pytest");
      expect(result).toContain("def test_example():");
      expect(result).toContain("assert True");
    });

    it("should return trimmed response when no markdown or test code detected", () => {
      const response = `  Some plain text response  `;

      const result = parseTestResponse(response);

      expect(result).toBe("Some plain text response");
    });

    it("should handle nested code blocks", () => {
      const response = `\`\`\`python
import pytest

def test_nested():
    code = """
    nested code
    """
    assert code
\`\`\``;

      const result = parseTestResponse(response);

      expect(result).toContain("import pytest");
      expect(result).toContain("def test_nested():");
    });

    it("should handle multiline assertions", () => {
      const response = `\`\`\`python
def test_multiline():
    result = calculate_sum([1, 2, 3])
    assert result == 6, "Sum should be 6"
\`\`\``;

      const result = parseTestResponse(response);

      expect(result).toContain("def test_multiline():");
      expect(result).toContain("assert result == 6");
    });

    it("should handle multiple test functions", () => {
      const response = `\`\`\`python
import pytest

def test_case_1():
    assert True

def test_case_2():
    assert False is False
\`\`\``;

      const result = parseTestResponse(response);

      expect(result).toContain("def test_case_1():");
      expect(result).toContain("def test_case_2():");
    });

    it("should handle markdown with description before code block", () => {
      const response = `## Test Implementation

This is a test suite.

\`\`\`python
import pytest

def test_implementation():
    pass
\`\`\`

That covers it.`;

      const result = parseTestResponse(response);

      expect(result).toContain("import pytest");
      expect(result).toContain("def test_implementation():");
    });

    it("should return empty string for empty response", () => {
      const result = parseTestResponse("");

      expect(result).toBe("");
    });

    it("should handle whitespace-only code blocks", () => {
      const response = `\`\`\`python

\`\`\``;

      const result = parseTestResponse(response);

      expect(result).toBe("");
    });
  });

  describe("TestGenerationConfig interface", () => {
    it("should have required fields", () => {
      const config: TestGenerationConfig = {
        llm_provider: "claude",
        test_framework: "pytest",
        output_dir: "/tests",
      };

      expect(config.llm_provider).toBe("claude");
      expect(config.test_framework).toBe("pytest");
      expect(config.output_dir).toBe("/tests");
    });

    it("should accept optional fields", () => {
      const config: TestGenerationConfig = {
        llm_provider: "openai",
        api_key: "test-key",
        model: "gpt-4",
        test_framework: "pytest",
        output_dir: "/tests",
      };

      expect(config.api_key).toBe("test-key");
      expect(config.model).toBe("gpt-4");
    });

    it("should support local provider", () => {
      const config: TestGenerationConfig = {
        llm_provider: "local",
        test_framework: "pytest",
        output_dir: "/tests",
      };

      expect(config.llm_provider).toBe("local");
    });
  });

  describe("GeneratedTest interface", () => {
    it("should create a valid GeneratedTest object", () => {
      const generatedTest = {
        function_name: "calculate_sum",
        function_hash: "abc123",
        test_file_path: "/tests/test_utils_calculate_sum.py",
        test_content: "import pytest\ndef test_calculate_sum():\n    assert True",
        test_type: "normal" as const,
        generated_at: "2026-05-15T10:00:00Z",
      };

      expect(generatedTest.function_name).toBe("calculate_sum");
      expect(generatedTest.test_type).toBe("normal");
    });

    it("should accept edge_case test type", () => {
      const generatedTest = {
        function_name: "validate_input",
        function_hash: "def456",
        test_file_path: "/tests/test_validators_validate_input.py",
        test_content: "import pytest\ndef test_empty_input():\n    with pytest.raises(ValueError):\n        validate_input('')",
        test_type: "edge_case" as const,
        generated_at: "2026-05-15T11:00:00Z",
      };

      expect(generatedTest.test_type).toBe("edge_case");
    });
  });

  describe("Integration scenarios", () => {
    it("should work end-to-end: generate prompt, parse response, build path", () => {
      const prompt = buildTestPrompt(mockFunctionSignature, mockChangeRecord, "edge_case");
      expect(prompt).toContain("calculate_sum");

      const llmResponse = `Here's the edge case test:

\`\`\`python
import pytest

def test_empty_list():
    assert calculate_sum([]) == 0

def test_with_offset():
    assert calculate_sum([1, 2, 3], offset=10) == 16
\`\`\``;

      const testContent = parseTestResponse(llmResponse);
      expect(testContent).toContain("def test_empty_list():");
      expect(testContent).toContain("def test_with_offset():");

      const testPath = buildTestFilePath(mockConfig, mockFunctionSignature, "utils.py");
      expect(testPath).toBe("/tests/test_utils_calculate_sum.py");
    });
  });
});