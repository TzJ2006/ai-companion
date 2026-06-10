import { describe, it, expect, beforeEach } from "vitest";
import {
  generateTestSkeleton,
  inferFromName,
  buildLlmEnhancePrompt,
  type TsTestGenConfig,
  type GeneratedTsTest,
} from "../../packages/core/src/test-gen/ts-generator.js";
import type { FunctionSignature, ParsedModule, ClassInfo } from "@aidev/ast";

describe("ts-generator", () => {
  let mockConfig: TsTestGenConfig;
  let mockFunctionSig: FunctionSignature;
  let mockMethodSig: FunctionSignature;
  let mockAsyncFunctionSig: FunctionSignature;

  beforeEach(() => {
    mockConfig = {
      test_framework: "vitest",
      output_dir: "/tmp/tests",
      include_source_body: false,
      llm_enhance: false,
    };

    mockFunctionSig = {
      name: "calculateSum",
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
    };

    mockMethodSig = {
      name: "getValue",
      params: [
        { name: "this", type: "MyClass", default_value: null, is_args: false, is_kwargs: false },
      ],
      return_type: "string",
      decorators: [],
      is_method: true,
      is_async: false,
      class_name: "MyClass",
      start_line: 5,
      end_line: 7,
      docstring: null,
    };

    mockAsyncFunctionSig = {
      name: "fetchData",
      params: [
        { name: "url", type: "string", default_value: null, is_args: false, is_kwargs: false },
      ],
      return_type: "Promise<any>",
      decorators: [],
      is_method: false,
      is_async: true,
      class_name: null,
      start_line: 10,
      end_line: 12,
      docstring: null,
    };
  });

  describe("generateTestSkeleton", () => {
    it("should execute without throwing", () => {
      const mod: ParsedModule = {
        file_path: "src/utils.ts",
        functions: [mockFunctionSig],
        classes: [],
        imports: [],
      };
      const result = generateTestSkeleton(mod, mockConfig);
      expect(result).toBeDefined();
    });

    it("should return correct type (GeneratedTsTest[])", () => {
      const mod: ParsedModule = {
        file_path: "src/utils.ts",
        functions: [mockFunctionSig],
        classes: [],
        imports: [],
      };
      const result = generateTestSkeleton(mod, mockConfig);
      expect(Array.isArray(result)).toBe(true);
    });

    it("should generate tests for module functions", () => {
      const mod: ParsedModule = {
        file_path: "src/utils.ts",
        functions: [mockFunctionSig],
        classes: [],
        imports: [],
      };
      const result = generateTestSkeleton(mod, mockConfig);
      expect(result).toHaveLength(1);
      expect(result[0].function_name).toBe("calculateSum");
      expect(result[0].class_name).toBeNull();
      expect(result[0].source_file).toBe("src/utils.ts");
    });

    it("should generate tests for classes", () => {
      const classInfo: ClassInfo = {
        name: "Calculator",
        methods: [mockMethodSig],
        decorators: [],
        start_line: 1,
        end_line: 10,
        bases: [],
      };
      const mod: ParsedModule = {
        file_path: "src/calculator.ts",
        functions: [],
        classes: [classInfo],
        imports: [],
      };
      const result = generateTestSkeleton(mod, mockConfig);
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0].class_name).toBe("Calculator");
    });

    it("should include generated_at timestamp", () => {
      const mod: ParsedModule = {
        file_path: "src/utils.ts",
        functions: [mockFunctionSig],
        classes: [],
        imports: [],
      };
      const result = generateTestSkeleton(mod, mockConfig);
      expect(result[0].generated_at).toBeDefined();
      expect(typeof result[0].generated_at).toBe("string");
      expect(new Date(result[0].generated_at).getTime()).toBeGreaterThan(0);
    });

    it("should generate test file path", () => {
      const mod: ParsedModule = {
        file_path: "src/utils.ts",
        functions: [mockFunctionSig],
        classes: [],
        imports: [],
      };
      const result = generateTestSkeleton(mod, mockConfig);
      expect(result[0].test_file_path).toContain("/tmp/tests/");
      expect(result[0].test_file_path).toContain(".test.ts");
    });

    it("should include test content", () => {
      const mod: ParsedModule = {
        file_path: "src/utils.ts",
        functions: [mockFunctionSig],
        classes: [],
        imports: [],
      };
      const result = generateTestSkeleton(mod, mockConfig);
      expect(result[0].test_content).toBeDefined();
      expect(typeof result[0].test_content).toBe("string");
      expect(result[0].test_content.length).toBeGreaterThan(0);
    });

    it("should generate vitest framework import", () => {
      const mod: ParsedModule = {
        file_path: "src/utils.ts",
        functions: [mockFunctionSig],
        classes: [],
        imports: [],
      };
      const result = generateTestSkeleton(mod, mockConfig);
      expect(result[0].test_content).toContain("vitest");
    });

    it("should generate async test for async functions", () => {
      const mod: ParsedModule = {
        file_path: "src/async.ts",
        functions: [mockAsyncFunctionSig],
        classes: [],
        imports: [],
      };
      const result = generateTestSkeleton(mod, mockConfig);
      expect(result[0].test_content).toContain("async");
    });

    it("should handle jest framework", () => {
      const jestConfig = { ...mockConfig, test_framework: "jest" as const };
      const mod: ParsedModule = {
        file_path: "src/utils.ts",
        functions: [mockFunctionSig],
        classes: [],
        imports: [],
      };
      const result = generateTestSkeleton(mod, jestConfig);
      expect(result[0].test_content).toContain("jest");
    });

    it("should handle empty modules", () => {
      const mod: ParsedModule = {
        file_path: "src/empty.ts",
        functions: [],
        classes: [],
        imports: [],
      };
      const result = generateTestSkeleton(mod, mockConfig);
      expect(result).toHaveLength(0);
    });

    it("should handle multiple functions", () => {
      const func2: FunctionSignature = {
        name: "multiply",
        params: [
          { name: "x", type: "number", default_value: null, is_args: false, is_kwargs: false },
          { name: "y", type: "number", default_value: null, is_args: false, is_kwargs: false },
        ],
        return_type: "number",
        decorators: [],
        is_method: false,
        is_async: false,
        class_name: null,
        start_line: 5,
        end_line: 7,
        docstring: null,
      };
      const mod: ParsedModule = {
        file_path: "src/math.ts",
        functions: [mockFunctionSig, func2],
        classes: [],
        imports: [],
      };
      const result = generateTestSkeleton(mod, mockConfig);
      expect(result).toHaveLength(2);
      expect(result[0].function_name).toBe("calculateSum");
      expect(result[1].function_name).toBe("multiply");
    });
  });

  describe("inferFromName", () => {
    it("should execute without throwing", () => {
      const result = inferFromName("testName");
      expect(result).toBeDefined();
    });

    it("should return string type", () => {
      const result = inferFromName("testName");
      expect(typeof result).toBe("string");
    });

    it("should infer file paths", () => {
      expect(inferFromName("filePath")).toContain("/tmp");
      expect(inferFromName("directory")).toContain("/tmp");
    });

    it("should infer IDs", () => {
      expect(inferFromName("userId")).toContain("abc123");
      expect(inferFromName("entityId")).toContain("abc123");
    });

    it("should infer counts", () => {
      expect(inferFromName("count")).toContain("10");
      expect(inferFromName("index")).toContain("10");
    });

    it("should infer booleans", () => {
      expect(inferFromName("enabled")).toContain("true");
      expect(inferFromName("isActive")).toContain("true");
    });

    it("should infer callbacks", () => {
      expect(inferFromName("callback")).toContain("() =>");
      expect(inferFromName("handler")).toContain("() =>");
    });

    it("should infer configs", () => {
      expect(inferFromName("options")).toContain("{}");
      expect(inferFromName("config")).toContain("{}");
    });

    it("should infer lists", () => {
      expect(inferFromName("items")).toContain("[]");
      expect(inferFromName("entries")).toContain("[]");
    });

    it("should handle unknown names", () => {
      const result = inferFromName("unknownParam");
      expect(result).toContain("undefined");
    });
  });

  describe("buildLlmEnhancePrompt", () => {
    it("should execute without throwing", () => {
      const result = buildLlmEnhancePrompt(mockFunctionSig, "", "");
      expect(result).toBeDefined();
    });

    it("should return non-empty string", () => {
      const result = buildLlmEnhancePrompt(mockFunctionSig, "", "");
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("should include source code", () => {
      const source = "function test() { return 42; }";
      const result = buildLlmEnhancePrompt(mockFunctionSig, source, "");
      expect(result).toContain(source);
    });

    it("should include function name", () => {
      const result = buildLlmEnhancePrompt(mockFunctionSig, "", "");
      expect(result).toContain("calculateSum");
    });

    it("should include return type", () => {
      const result = buildLlmEnhancePrompt(mockFunctionSig, "", "");
      expect(result).toContain("number");
    });

    it("should include parameters", () => {
      const result = buildLlmEnhancePrompt(mockFunctionSig, "", "");
      expect(result).toContain("a:");
    });

    it("should mark async functions", () => {
      const result = buildLlmEnhancePrompt(mockAsyncFunctionSig, "", "");
      expect(result).toContain("async");
    });

    it("should include skeleton", () => {
      const skeleton = "it('test', () => {})";
      const result = buildLlmEnhancePrompt(mockFunctionSig, "", skeleton);
      expect(result).toContain(skeleton);
    });

    it("should use markdown format", () => {
      const result = buildLlmEnhancePrompt(mockFunctionSig, "s", "sk");
      expect(result).toContain("##");
      expect(result).toContain("```");
    });

    it("should include instructions", () => {
      const result = buildLlmEnhancePrompt(mockFunctionSig, "", "");
      expect(result.toLowerCase()).toContain("test");
      expect(result.toLowerCase()).toContain("assertion");
    });

    it("should handle no parameters", () => {
      const fn: FunctionSignature = { ...mockFunctionSig, params: [] };
      const result = buildLlmEnhancePrompt(fn, "", "");
      expect(result).toContain("()");
    });

    it("should handle no return type", () => {
      const fn: FunctionSignature = { ...mockFunctionSig, return_type: null };
      const result = buildLlmEnhancePrompt(fn, "", "");
      expect(result).toContain("unknown");
    });
  });

  describe("integration", () => {
    it("should work with throwable functions", () => {
      const fn: FunctionSignature = {
        name: "validate",
        params: [{ name: "data", type: "string", default_value: null, is_args: false, is_kwargs: false }],
        return_type: "boolean",
        decorators: [],
        is_method: false,
        is_async: false,
        class_name: null,
        start_line: 1,
        end_line: 5,
        docstring: "Throws on invalid data",
      };
      const mod: ParsedModule = {
        file_path: "src/validators.ts",
        functions: [fn],
        classes: [],
        imports: [],
      };
      const result = generateTestSkeleton(mod, mockConfig);
      expect(result[0].test_content).toContain("throw");
    });

    it("should skip private methods in classes", () => {
      const classInfo: ClassInfo = {
        name: "Service",
        methods: [
          {
            name: "publicMethod",
            params: [{ name: "this", type: "Service", default_value: null, is_args: false, is_kwargs: false }],
            return_type: "string",
            decorators: [],
            is_method: true,
            is_async: false,
            class_name: "Service",
            start_line: 1,
            end_line: 3,
            docstring: null,
          },
          {
            name: "_privateMethod",
            params: [{ name: "this", type: "Service", default_value: null, is_args: false, is_kwargs: false }],
            return_type: "string",
            decorators: [],
            is_method: true,
            is_async: false,
            class_name: "Service",
            start_line: 5,
            end_line: 7,
            docstring: null,
          },
        ],
        decorators: [],
        start_line: 1,
        end_line: 8,
        bases: [],
      };
      const mod: ParsedModule = {
        file_path: "src/service.ts",
        functions: [],
        classes: [classInfo],
        imports: [],
      };
      const result = generateTestSkeleton(mod, mockConfig);
      expect(result[0].test_content).toContain("publicMethod");
      expect(result[0].test_content).not.toContain("_privateMethod");
    });
  });
});
