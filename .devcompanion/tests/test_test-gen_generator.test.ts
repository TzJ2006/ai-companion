import { describe, it, expect } from "vitest";
import {
  buildTestPrompt,
  buildTestFilePath,
  parseTestResponse,
} from "../../packages/core/src/test-gen/generator.js";
import type { FunctionSignature } from "@aidev/ast";
import type { ChangeRecord } from "@aidev/history";
import type { TestGenerationConfig } from "../../packages/core/src/test-gen/generator.js";

const baseFn: FunctionSignature = {
  name: "calculate_total",
  class_name: null,
  params: [
    { name: "items", type: "list[dict]", default_value: null },
    { name: "tax_rate", type: "float", default_value: "0.0" },
  ],
  return_type: "float",
  docstring: "Calculate the total price including tax.",
  start_line: 10,
  end_line: 20,
  is_async: false,
  decorators: [],
  identity_hash: "abc123def456",
};

const classFn: FunctionSignature = {
  name: "process",
  class_name: "OrderProcessor",
  params: [
    { name: "self", type: null, default_value: null },
    { name: "order_id", type: "str", default_value: null },
  ],
  return_type: "Order",
  docstring: null,
  start_line: 30,
  end_line: 50,
  is_async: true,
  decorators: ["@retry(3)"],
  identity_hash: "xyz789000111",
};

const changeRecord: ChangeRecord = {
  reason: "Added tax calculation logic",
  new_content: "def calculate_total(items, tax_rate=0.0):\n    subtotal = sum(i['price'] for i in items)\n    return subtotal * (1 + tax_rate)",
} as unknown as ChangeRecord;

const baseConfig: TestGenerationConfig = {
  test_framework: "pytest",
  output_dir: "tests/generated",
};

describe("buildTestPrompt", () => {
  it("includes function name in prompt", () => {
    const result = buildTestPrompt(baseFn, null, "normal");
    expect(result).toContain("calculate_total");
  });

  it("includes parameter descriptions with types", () => {
    const result = buildTestPrompt(baseFn, null, "normal");
    expect(result).toContain("- items: list[dict]");
    expect(result).toContain("- tax_rate: float = 0.0");
  });

  it("includes return type section", () => {
    const result = buildTestPrompt(baseFn, null, "normal");
    expect(result).toContain("## Return Type\nfloat");
  });

  it("includes docstring when present", () => {
    const result = buildTestPrompt(baseFn, null, "normal");
    expect(result).toContain("## Docstring");
    expect(result).toContain("Calculate the total price including tax.");
  });

  it("omits docstring section when null", () => {
    const result = buildTestPrompt(classFn, null, "normal");
    expect(result).not.toContain("## Docstring");
  });

  it("includes change context when change record provided", () => {
    const result = buildTestPrompt(baseFn, changeRecord, "normal");
    expect(result).toContain("## Change Context");
    expect(result).toContain("Added tax calculation logic");
    expect(result).toContain("def calculate_total");
  });

  it("omits change context when change is null", () => {
    const result = buildTestPrompt(baseFn, null, "normal");
    expect(result).not.toContain("## Change Context");
  });

  it("uses happy path instruction for normal test type", () => {
    const result = buildTestPrompt(baseFn, null, "normal");
    expect(result).toContain("happy path and typical usage patterns");
  });

  it("uses edge case instruction for edge_case test type", () => {
    const result = buildTestPrompt(baseFn, null, "edge_case");
    expect(result).toContain("edge cases: empty inputs, None values");
  });

  it("includes async keyword for async functions", () => {
    const result = buildTestPrompt(classFn, null, "normal");
    expect(result).toContain("async def");
  });

  it("includes class name prefix for methods", () => {
    const result = buildTestPrompt(classFn, null, "normal");
    expect(result).toContain("OrderProcessor.process");
  });

  it("formats params without types as Any", () => {
    const result = buildTestPrompt(classFn, null, "normal");
    expect(result).toContain("- self: Any");
  });

  it("includes pytest output instruction", () => {
    const result = buildTestPrompt(baseFn, null, "normal");
    expect(result).toContain("Output ONLY valid Python test code using pytest");
  });
});

describe("buildTestFilePath", () => {
  it("generates path for standalone function", () => {
    const result = buildTestFilePath(baseConfig, baseFn, "src/pricing.py");
    expect(result).toBe("tests/generated/test_pricing_calculate_total.py");
  });

  it("generates path including class name for methods", () => {
    const result = buildTestFilePath(baseConfig, classFn, "src/orders/processor.py");
    expect(result).toBe("tests/generated/test_processor_OrderProcessor_process.py");
  });

  it("handles nested source paths by using only filename", () => {
    const result = buildTestFilePath(baseConfig, baseFn, "a/b/c/deep/module.py");
    expect(result).toBe("tests/generated/test_module_calculate_total.py");
  });

  it("respects output_dir from config", () => {
    const customConfig = { ...baseConfig, output_dir: "custom/output" };
    const result = buildTestFilePath(customConfig, baseFn, "src/pricing.py");
    expect(result).toContain("custom/output/");
  });

  it("handles source path without directory", () => {
    const result = buildTestFilePath(baseConfig, baseFn, "standalone.py");
    expect(result).toBe("tests/generated/test_standalone_calculate_total.py");
  });

  it("falls back to 'module' when filename extraction fails", () => {
    const fn = { ...baseFn };
    const result = buildTestFilePath(baseConfig, fn, "");
    expect(result).toContain("test_");
  });
});

describe("parseTestResponse", () => {
  it("extracts code from python code block", () => {
    const response = "Here is the test:\n```python\nimport pytest\n\ndef test_add():\n    assert add(1, 2) == 3\n```\nDone.";
    const result = parseTestResponse(response);
    expect(result).toBe("import pytest\n\ndef test_add():\n    assert add(1, 2) == 3");
  });

  it("returns trimmed response when it looks like raw python code", () => {
    const response = "import pytest\n\ndef test_subtract():\n    assert subtract(5, 3) == 2\n";
    const result = parseTestResponse(response);
    expect(result).toBe("import pytest\n\ndef test_subtract():\n    assert subtract(5, 3) == 2");
  });

  it("returns trimmed response when no code block and no recognizable pattern", () => {
    const response = "   some plain text response   ";
    const result = parseTestResponse(response);
    expect(result).toBe("some plain text response");
  });

  it("handles multiple code blocks by extracting first python block", () => {
    const response = "```python\nfirst_block\n```\n\n```python\nsecond_block\n```";
    const result = parseTestResponse(response);
    expect(result).toBe("first_block");
  });

  it("handles empty string input", () => {
    const result = parseTestResponse("");
    expect(result).toBe("");
  });

  it("handles code block with only whitespace content", () => {
    const response = "```python\n   \n```";
    const result = parseTestResponse(response);
    expect(result).toBe("");
  });

  it("prefers code block extraction over raw code detection", () => {
    const response = "import os\ndef test_foo():\n    pass\n```python\nimport pytest\ndef test_bar():\n    assert True\n```";
    const result = parseTestResponse(response);
    expect(result).toBe("import pytest\ndef test_bar():\n    assert True");
  });

  it("returns correct type", () => {
    const result = parseTestResponse("test input");
    expect(typeof result).toBe("string");
  });

  it("throws on null input", () => {
    expect(() => parseTestResponse(null as any)).toThrow();
  });

  it("throws on undefined input", () => {
    expect(() => parseTestResponse(undefined as any)).toThrow();
  });
});
