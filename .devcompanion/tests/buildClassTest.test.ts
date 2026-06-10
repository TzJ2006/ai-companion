import { describe, it, expect, beforeEach } from "vitest";
import {
  buildLlmEnhancePrompt,
  generateTestSkeleton,
} from "../../packages/core/src/test-gen/ts-generator.js";
import type { FunctionSignature, ParsedModule } from "@aidev/ast";
import type { TsTestGenConfig, GeneratedTsTest } from "../../packages/core/src/test-gen/ts-generator.js";

describe("buildLlmEnhancePrompt function", () => {
  it("should return a string", () => {
    const fn: FunctionSignature = {
      name: "test",
      params: [],
      return_type: "void",
      decorators: [],
      is_method: false,
      is_async: false,
      class_name: null,
      start_line: 1,
      end_line: 1,
      docstring: null,
    };
    const result = buildLlmEnhancePrompt(fn, "", "");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("should include senior test engineer instruction", () => {
    const fn: FunctionSignature = {
      name: "calculate",
      params: [],
      return_type: "number",
      decorators: [],
      is_method: false,
      is_async: false,
      class_name: null,
      start_line: 1,
      end_line: 5,
      docstring: "Calculates result",
    };
    const result = buildLlmEnhancePrompt(fn, "return 1 + 2;", "");
    expect(result).toContain("You are a senior test engineer");
    expect(result).toContain("## Source Function");
    expect(result).toContain("## Function Signature");
  });

  it("should mark functions as async", () => {
    const fn: FunctionSignature = {
      name: "fetchData",
      params: [],
      return_type: "Promise<object>",
      decorators: [],
      is_method: false,
      is_async: true,
      class_name: null,
      start_line: 1,
      end_line: 10,
      docstring: null,
    };
    const result = buildLlmEnhancePrompt(fn, "", "");
    expect(result).toContain("async function fetchData");
  });

  it("should include class name for methods", () => {
    const fn: FunctionSignature = {
      name: "getValue",
      params: [],
      return_type: "string",
      decorators: [],
      is_method: true,
      is_async: false,
      class_name: "Service",
      start_line: 5,
      end_line: 8,
      docstring: null,
    };
    const result = buildLlmEnhancePrompt(fn, "", "");
    expect(result).toContain("Service.getValue");
  });

  it("should end prompt with typescript code fence", () => {
    const fn: FunctionSignature = {
      name: "test",
      params: [],
      return_type: "void",
      decorators: [],
      is_method: false,
      is_async: false,
      class_name: null,
      start_line: 1,
      end_line: 1,
      docstring: null,
    };
    const result = buildLlmEnhancePrompt(fn, "", "");
    expect(result).toMatch(/`typescript\n$/);
  });

  it("should include source body in prompt", () => {
    const fn: FunctionSignature = {
      name: "sum",
      params: [
        { name: "a", type: "number", default_value: null, is_args: false, is_kwargs: false },
        { name: "b", type: "number", default_value: null, is_args: false, is_kwargs: false },
      ],
      return_type: "number",
      decorators: [],
      is_method: false,
      is_async: false,
      class_name: null,
      start_line: 1,
      end_line: 3,
      docstring: "Sums two numbers",
    };
    const sourceBody = "return a + b;";
    const result = buildLlmEnhancePrompt(fn, sourceBody, "");
    expect(result).toContain(sourceBody);
  });

  it("should format function parameters in signature", () => {
    const fn: FunctionSignature = {
      name: "process",
      params: [
        { name: "input", type: "string", default_value: null, is_args: false, is_kwargs: false },
        { name: "limit", type: "number", default_value: "10", is_args: false, is_kwargs: false },
      ],
      return_type: "string[]",
      decorators: [],
      is_method: false,
      is_async: false,
      class_name: null,
      start_line: 1,
      end_line: 5,
      docstring: null,
    };
    const result = buildLlmEnhancePrompt(fn, "return input.split(',');", "");
    expect(result).toContain("input: string");
    expect(result).toContain("limit: number");
    expect(result).toContain("string[]");
  });
});

describe("generateTestSkeleton function", () => {
  let config: TsTestGenConfig;

  beforeEach(() => {
    config = {
      test_framework: "vitest",
      output_dir: "./dist/tests",
      include_source_body: true,
      llm_enhance: false,
    };
  });

  it("should return array of GeneratedTsTest", () => {
    const mod: ParsedModule = {
      file_path: "src/test.ts",
      functions: [],
      classes: [],
      imports: [],
    };
    const result = generateTestSkeleton(mod, config);
    expect(Array.isArray(result)).toBe(true);
  });

  it("should generate tests for functions", () => {
    const mod: ParsedModule = {
      file_path: "src/utils.ts",
      functions: [
        {
          name: "add",
          params: [
            { name: "a", type: "number", default_value: null, is_args: false, is_kwargs: false },
            { name: "b", type: "number", default_value: null, is_args: false, is_kwargs: false },
          ],
          return_type: "number",
          decorators: [],
          is_method: false,
          is_async: false,
          class_name: null,
          start_line: 1,
          end_line: 3,
          docstring: null,
        },
      ],
      classes: [],
      imports: [],
    };
    const result = generateTestSkeleton(mod, config);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].function_name).toBe("add");
    expect(result[0].class_name).toBeNull();
    expect(result[0].source_file).toBe("src/utils.ts");
  });

  it("should generate tests for classes", () => {
    const mod: ParsedModule = {
      file_path: "src/service.ts",
      functions: [],
      classes: [
        {
          name: "MyService",
          methods: [
            {
              name: "constructor",
              params: [],
              return_type: null,
              decorators: [],
              is_method: true,
              is_async: false,
              class_name: "MyService",
              start_line: 1,
              end_line: 2,
              docstring: null,
            },
            {
              name: "doWork",
              params: [],
              return_type: "void",
              decorators: [],
              is_method: true,
              is_async: false,
              class_name: "MyService",
              start_line: 4,
              end_line: 6,
              docstring: null,
            },
          ],
          decorators: [],
          start_line: 1,
          end_line: 7,
          bases: [],
        },
      ],
      imports: [],
    };
    const result = generateTestSkeleton(mod, config);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].function_name).toBe("MyService");
    expect(result[0].class_name).toBe("MyService");
  });

  it("should generate for both functions and classes", () => {
    const mod: ParsedModule = {
      file_path: "src/mixed.ts",
      functions: [
        {
          name: "helperFunc",
          params: [],
          return_type: "string",
          decorators: [],
          is_method: false,
          is_async: false,
          class_name: null,
          start_line: 1,
          end_line: 3,
          docstring: null,
        },
      ],
      classes: [
        {
          name: "Handler",
          methods: [
            {
              name: "constructor",
              params: [],
              return_type: null,
              decorators: [],
              is_method: true,
              is_async: false,
              class_name: "Handler",
              start_line: 5,
              end_line: 6,
              docstring: null,
            },
          ],
          decorators: [],
          start_line: 5,
          end_line: 10,
          bases: [],
        },
      ],
      imports: [],
    };
    const result = generateTestSkeleton(mod, config);
    expect(result.length).toBe(2);
    expect(result[0].function_name).toBe("helperFunc");
    expect(result[0].class_name).toBeNull();
    expect(result[1].function_name).toBe("Handler");
    expect(result[1].class_name).toBe("Handler");
  });

  it("should set generated_at timestamp to ISO format", () => {
    const mod: ParsedModule = {
      file_path: "src/test.ts",
      functions: [
        {
          name: "testFunc",
          params: [],
          return_type: "void",
          decorators: [],
          is_method: false,
          is_async: false,
          class_name: null,
          start_line: 1,
          end_line: 1,
          docstring: null,
        },
      ],
      classes: [],
      imports: [],
    };
    const result = generateTestSkeleton(mod, config);
    expect(result[0].generated_at).toBeDefined();
    const timestamp = new Date(result[0].generated_at);
    expect(timestamp.getTime()).toBeGreaterThan(0);
  });

  it("should use same timestamp for all results in call", () => {
    const mod: ParsedModule = {
      file_path: "src/multi.ts",
      functions: [
        {
          name: "func1",
          params: [],
          return_type: "void",
          decorators: [],
          is_method: false,
          is_async: false,
          class_name: null,
          start_line: 1,
          end_line: 1,
          docstring: null,
        },
        {
          name: "func2",
          params: [],
          return_type: "void",
          decorators: [],
          is_method: false,
          is_async: false,
          class_name: null,
          start_line: 3,
          end_line: 3,
          docstring: null,
        },
      ],
      classes: [],
      imports: [],
    };
    const result = generateTestSkeleton(mod, config);
    expect(result[0].generated_at).toBe(result[1].generated_at);
  });

  it("should include source file path in results", () => {
    const mod: ParsedModule = {
      file_path: "src/example.ts",
      functions: [
        {
          name: "example",
          params: [],
          return_type: "void",
          decorators: [],
          is_method: false,
          is_async: false,
          class_name: null,
          start_line: 1,
          end_line: 1,
          docstring: null,
        },
      ],
      classes: [],
      imports: [],
    };
    const result = generateTestSkeleton(mod, config);
    expect(result[0].source_file).toBe("src/example.ts");
  });

  it("should generate correct test file paths", () => {
    const mod: ParsedModule = {
      file_path: "src/calculator.ts",
      functions: [
        {
          name: "multiply",
          params: [
            { name: "a", type: "number", default_value: null, is_args: false, is_kwargs: false },
            { name: "b", type: "number", default_value: null, is_args: false, is_kwargs: false },
          ],
          return_type: "number",
          decorators: [],
          is_method: false,
          is_async: false,
          class_name: null,
          start_line: 1,
          end_line: 3,
          docstring: null,
        },
      ],
      classes: [],
      imports: [],
    };
    const result = generateTestSkeleton(mod, config);
    expect(result[0].test_file_path).toContain("test_calculator_multiply.test.ts");
    expect(result[0].test_file_path).toContain(config.output_dir);
  });

  it("should generate valid test content with describe and it blocks", () => {
    const mod: ParsedModule = {
      file_path: "src/service.ts",
      functions: [
        {
          name: "getValue",
          params: [],
          return_type: "string",
          decorators: [],
          is_method: false,
          is_async: false,
          class_name: null,
          start_line: 1,
          end_line: 3,
          docstring: null,
        },
      ],
      classes: [],
      imports: [],
    };
    const result = generateTestSkeleton(mod, config);
    expect(result[0].test_content).toContain('describe("getValue"');
    expect(result[0].test_content).toContain('it("should');
    expect(result[0].test_content).toContain("import");
  });

  it("should support vitest framework", () => {
    const mod: ParsedModule = {
      file_path: "src/test.ts",
      functions: [
        {
          name: "testFunc",
          params: [],
          return_type: "void",
          decorators: [],
          is_method: false,
          is_async: false,
          class_name: null,
          start_line: 1,
          end_line: 1,
          docstring: null,
        },
      ],
      classes: [],
      imports: [],
    };
    const result = generateTestSkeleton(mod, config);
    expect(result[0].test_content).toContain('from "vitest"');
  });

  it("should support jest framework", () => {
    const jestConfig: TsTestGenConfig = {
      test_framework: "jest",
      output_dir: "./dist/tests",
      include_source_body: true,
      llm_enhance: false,
    };
    const mod: ParsedModule = {
      file_path: "src/test.ts",
      functions: [
        {
          name: "testFunc",
          params: [],
          return_type: "void",
          decorators: [],
          is_method: false,
          is_async: false,
          class_name: null,
          start_line: 1,
          end_line: 1,
          docstring: null,
        },
      ],
      classes: [],
      imports: [],
    };
    const result = generateTestSkeleton(mod, jestConfig);
    expect(result[0].test_content).toContain('from "jest"');
  });

  it("should generate tests with async methods", () => {
    const mod: ParsedModule = {
      file_path: "src/async.ts",
      functions: [
        {
          name: "fetchData",
          params: [
            { name: "id", type: "string", default_value: null, is_args: false, is_kwargs: false },
          ],
          return_type: "Promise<object>",
          decorators: [],
          is_method: false,
          is_async: true,
          class_name: null,
          start_line: 1,
          end_line: 5,
          docstring: null,
        },
      ],
      classes: [],
      imports: [],
    };
    const result = generateTestSkeleton(mod, config);
    expect(result[0].test_content).toContain("async");
    expect(result[0].test_content).toContain("await");
  });

  it("should handle empty modules", () => {
    const mod: ParsedModule = {
      file_path: "src/empty.ts",
      functions: [],
      classes: [],
      imports: [],
    };
    const result = generateTestSkeleton(mod, config);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });
});
