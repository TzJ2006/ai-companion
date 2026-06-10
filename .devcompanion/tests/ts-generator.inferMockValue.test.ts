import { describe, it, expect } from "vitest";

// Note: inferMockValue is an internal helper function not exported by the module.
// This test directly imports from the implementation for thorough internal testing.
// In production, users should test through the exported API (generateTestSkeleton, buildLlmEnhancePrompt).

// @ts-ignore - testing internal implementation
import { inferMockValue } from "../../packages/core/src/test-gen/ts-generator.js";

describe("inferMockValue", () => {
  describe("type-based inference", () => {
    it("should return string for string type", () => {
      const result = inferMockValue("param", "string");
      expect(typeof result).toBe("string");
      expect(result).toBe(`"test-param"`);
    });

    it("should return string for String (capitalized) type", () => {
      const result = inferMockValue("param", "String");
      expect(typeof result).toBe("string");
      expect(result).toContain("test-param");
    });

    it("should return number string for number type", () => {
      const result = inferMockValue("param", "number");
      expect(result).toBe("42");
    });

    it("should return number string for int type", () => {
      const result = inferMockValue("param", "int");
      expect(result).toBe("42");
    });

    it("should return number string for float type", () => {
      const result = inferMockValue("param", "float");
      expect(result).toBe("42");
    });

    it("should return boolean string for boolean type", () => {
      const result = inferMockValue("param", "boolean");
      expect(result).toBe("true");
    });

    it("should return boolean string for bool type", () => {
      const result = inferMockValue("param", "bool");
      expect(result).toBe("true");
    });

    it("should return array of strings for string[] type", () => {
      const result = inferMockValue("param", "string[]");
      expect(result).toBe(`["a", "b"]`);
    });

    it("should return array of strings for array<string> type", () => {
      const result = inferMockValue("param", "array<string>");
      expect(result).toBe(`["a", "b"]`);
    });

    it("should return array of numbers for number[] type", () => {
      const result = inferMockValue("param", "number[]");
      expect(result).toBe("[1, 2, 3]");
    });

    it("should return array of numbers for array<number> type", () => {
      const result = inferMockValue("param", "array<number>");
      expect(result).toBe("[1, 2, 3]");
    });

    it("should return empty array for generic array type", () => {
      const result = inferMockValue("param", "Array");
      expect(result).toBe("[]");
    });

    it("should return empty array for array[] type", () => {
      const result = inferMockValue("param", "array[]");
      expect(result).toBe("[]");
    });

    it("should return empty object for map type", () => {
      const result = inferMockValue("param", "Map<string, string>");
      expect(result).toBe("{}");
    });

    it("should return empty object for record type", () => {
      const result = inferMockValue("param", "Record<string, any>");
      expect(result).toBe("{}");
    });

    it("should handle promise types by unwrapping and inferring inner type", () => {
      const result = inferMockValue("param", "Promise<string>");
      expect(result).toContain("test-param");
    });

    it("should return undefined for void type", () => {
      const result = inferMockValue("param", "void");
      expect(result).toBe("undefined");
    });

    it("should return undefined for undefined type", () => {
      const result = inferMockValue("param", "undefined");
      expect(result).toBe("undefined");
    });

    it("should return null for null type", () => {
      const result = inferMockValue("param", "null");
      expect(result).toBe("null");
    });

    it("should handle whitespace in type names", () => {
      const result = inferMockValue("param", "string [ ]");
      expect(result).toContain("a");
    });
  });

  describe("name-based inference (no type provided)", () => {
    it("should infer path value from path keyword in name", () => {
      const result = inferMockValue("filePath", null);
      expect(result).toBe(`"/tmp/test"`);
    });

    it("should infer path value from file keyword in name", () => {
      const result = inferMockValue("fileName", null);
      expect(result).toBe(`"/tmp/test"`);
    });

    it("should infer path value from dir keyword in name", () => {
      const result = inferMockValue("directory", null);
      expect(result).toBe(`"/tmp/test"`);
    });

    it("should infer name value from name keyword in parameter", () => {
      const result = inferMockValue("name", null);
      expect(result).toBe(`"test-name"`);
    });

    it("should infer name value from label keyword in parameter", () => {
      const result = inferMockValue("label", null);
      expect(result).toBe(`"test-name"`);
    });

    it("should infer name value from title keyword in parameter", () => {
      const result = inferMockValue("title", null);
      expect(result).toBe(`"test-name"`);
    });

    it("should infer id value from id keyword in parameter name", () => {
      const result = inferMockValue("id", null);
      expect(result).toBe(`"abc123"`);
    });

    it("should infer id value from hash keyword in parameter name", () => {
      const result = inferMockValue("hash", null);
      expect(result).toBe(`"abc123"`);
    });

    it("should infer count value from count keyword in parameter name", () => {
      const result = inferMockValue("count", null);
      expect(result).toBe("10");
    });

    it("should infer count value from num keyword in parameter name", () => {
      const result = inferMockValue("numItems", null);
      expect(result).toBe("10");
    });

    it("should infer count value from index keyword in parameter name", () => {
      const result = inferMockValue("index", null);
      expect(result).toBe("10");
    });

    it("should infer count value from limit keyword in parameter name", () => {
      const result = inferMockValue("limit", null);
      expect(result).toBe("10");
    });

    it("should infer boolean value from flag keyword in parameter name", () => {
      const result = inferMockValue("flag", null);
      expect(result).toBe("true");
    });

    it("should infer boolean value from enabled keyword in parameter name", () => {
      const result = inferMockValue("enabled", null);
      expect(result).toBe("true");
    });

    it("should infer boolean value from active keyword in parameter name", () => {
      const result = inferMockValue("active", null);
      expect(result).toBe("true");
    });

    it("should infer object value from options keyword in parameter name", () => {
      const result = inferMockValue("options", null);
      expect(result).toBe("{}");
    });

    it("should infer object value from config keyword in parameter name", () => {
      const result = inferMockValue("config", null);
      expect(result).toBe("{}");
    });

    it("should infer object value from opts keyword in parameter name", () => {
      const result = inferMockValue("opts", null);
      expect(result).toBe("{}");
    });

    it("should infer array value from items keyword in parameter name", () => {
      const result = inferMockValue("items", null);
      expect(result).toBe("[]");
    });

    it("should infer array value from list keyword in parameter name", () => {
      const result = inferMockValue("list", null);
      expect(result).toBe("[]");
    });

    it("should infer array value from entries keyword in parameter name", () => {
      const result = inferMockValue("entries", null);
      expect(result).toBe("[]");
    });

    it("should infer callback value from callback keyword in parameter name", () => {
      const result = inferMockValue("callback", null);
      expect(result).toBe("() => {}");
    });

    it("should infer callback value from fn keyword in parameter name", () => {
      const result = inferMockValue("fn", null);
      expect(result).toBe("() => {}");
    });

    it("should infer callback value from handler keyword in parameter name", () => {
      const result = inferMockValue("handler", null);
      expect(result).toBe("() => {}");
    });

    it("should infer string value from source keyword in parameter name", () => {
      const result = inferMockValue("source", null);
      expect(result).toBe(`"test content"`);
    });

    it("should infer string value from content keyword in parameter name", () => {
      const result = inferMockValue("content", null);
      expect(result).toBe(`"test content"`);
    });

    it("should infer string value from text keyword in parameter name", () => {
      const result = inferMockValue("text", null);
      expect(result).toBe(`"test content"`);
    });
  });

  describe("fallback behavior", () => {
    it("should return TODO comment for unknown parameter name and no type", () => {
      const result = inferMockValue("unknownParam", null);
      expect(result).toContain("TODO");
      expect(result).toContain("unknownParam");
    });

    it("should return TODO comment for completely unknown type", () => {
      const result = inferMockValue("param", "CustomType");
      expect(result).toContain("TODO");
    });
  });

  describe("case insensitivity and whitespace handling", () => {
    it("should handle uppercase STRING type", () => {
      const result = inferMockValue("param", "STRING");
      expect(result).toContain("test-param");
    });

    it("should handle mixed case type names", () => {
      const result = inferMockValue("param", "BoOlEaN");
      expect(result).toBe("true");
    });

    it("should strip whitespace from type names", () => {
      const result = inferMockValue("param", "string [ ]");
      expect(typeof result).toBe("string");
    });

    it("should handle types with internal spaces", () => {
      const result = inferMockValue("param", "Promise < string >");
      expect(result).toContain("test-param");
    });
  });

  describe("edge cases", () => {
    it("should handle empty string parameter name", () => {
      const result = inferMockValue("", "string");
      expect(result).toBe(`"test-"`);
    });

    it("should handle special characters in parameter name", () => {
      const result = inferMockValue("test-param-name", "string");
      expect(result).toContain("test-");
    });

    it("should handle very long parameter name", () => {
      const result = inferMockValue("thisIsAVeryLongParameterNameWithManyWords", null);
      expect(typeof result).toBe("string");
    });

    it("should prioritize type over name when both are provided", () => {
      const result = inferMockValue("callbackOptions", "string");
      expect(result).toBe(`"test-callbackOptions"`);
    });

    it("should handle nested generic types", () => {
      const result = inferMockValue("data", "Promise<string[]>");
      expect(result).toBe("[]");
    });

    it("should not throw with valid inputs", () => {
      expect(() => inferMockValue("validParam", "number")).not.toThrow();
    });

    it("should always return a string", () => {
      expect(typeof inferMockValue("test", "string")).toBe("string");
      expect(typeof inferMockValue("test", "number")).toBe("string");
      expect(typeof inferMockValue("test", null)).toBe("string");
    });
  });

  describe("real-world parameter patterns", () => {
    it("should handle userId parameter with string type", () => {
      const result = inferMockValue("userId", "string");
      expect(result).toBe(`"test-userId"`);
    });

    it("should handle getData function parameter", () => {
      const result = inferMockValue("getData", null);
      expect(result).toBe(`undefined /* TODO: provide getData */`);
    });

    it("should handle isEnabled parameter", () => {
      const result = inferMockValue("isEnabled", null);
      expect(result).toBe("true");
    });

    it("should handle configPath parameter", () => {
      const result = inferMockValue("configPath", null);
      expect(result).toBe(`"/tmp/test"`);
    });

    it("should handle itemList parameter", () => {
      const result = inferMockValue("itemList", null);
      expect(result).toBe("[]");
    });

    it("should handle errorHandler parameter", () => {
      const result = inferMockValue("errorHandler", null);
      expect(result).toBe("() => {}");
    });

    it("should handle sourceContent parameter", () => {
      const result = inferMockValue("sourceContent", null);
      expect(result).toBe(`"test content"`);
    });
  });
});
