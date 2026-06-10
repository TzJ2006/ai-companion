import { describe, it, expect, vi } from "vitest";
import {
  computeFunctionIdentity,
  getSupportedExtensions,
  initParsers,
  parseFileAuto,
} from "../../packages/ast/src/index.js";
import type {
  FunctionSignature,
  FunctionParam,
  FunctionIdentity,
  ParsedModule,
  ClassInfo,
  ImportInfo,
} from "../../packages/ast/src/index.js";

describe("AST Module Exports", () => {
  const makeFn = (overrides: Partial<FunctionSignature> = {}): FunctionSignature => ({
    name: "testFunc",
    params: [],
    return_type: null,
    decorators: [],
    is_method: false,
    is_async: false,
    class_name: null,
    start_line: 1,
    end_line: 5,
    docstring: null,
    ...overrides,
  });
  describe("computeFunctionIdentity", () => {
    it("should compute function identity with correct hash format", () => {
      const fn = makeFn({
        name: "myFunc",
        params: [
          {
            name: "x",
            type: "string",
            default_value: null,
            is_args: false,
            is_kwargs: false,
          },
        ],
      });
      const result = computeFunctionIdentity("src/index.ts", fn);

      expect(result.hash).toMatch(/^[0-9a-f]{16}$/);
      expect(result.file_path).toBe("src/index.ts");
      expect(result.function_name).toBe("myFunc");
      expect(result.param_signature).toBe("x:string");
    });

    it("should handle methods with self parameter", () => {
      const fn = makeFn({
        name: "method",
        class_name: "MyClass",
        params: [
          {
            name: "self",
            type: "MyClass",
            default_value: null,
            is_args: false,
            is_kwargs: false,
          },
          {
            name: "value",
            type: "number",
            default_value: null,
            is_args: false,
            is_kwargs: false,
          },
        ],
      });
      const result = computeFunctionIdentity("models/class.ts", fn);

      expect(result.class_name).toBe("MyClass");
      expect(result.param_signature).toBe("value:number");
    });

    it("should produce deterministic hashes", () => {
      const fn = makeFn({ name: "stable" });
      const hash1 = computeFunctionIdentity("file.ts", fn).hash;
      const hash2 = computeFunctionIdentity("file.ts", fn).hash;

      expect(hash1).toBe(hash2);
    });

    it("should differentiate functions with different names", () => {
      const fn1 = makeFn({ name: "func1" });
      const fn2 = makeFn({ name: "func2" });

      const hash1 = computeFunctionIdentity("file.ts", fn1).hash;
      const hash2 = computeFunctionIdentity("file.ts", fn2).hash;

      expect(hash1).not.toBe(hash2);
    });

    it("should handle functions with no type annotations", () => {
      const fn = makeFn({
        name: "untyped",
        params: [
          {
            name: "arg",
            type: null,
            default_value: null,
            is_args: false,
            is_kwargs: false,
          },
        ],
      });
      const result = computeFunctionIdentity("untyped.ts", fn);

      expect(result.param_signature).toBe("arg:any");
    });

    it("should handle cls parameter filtering", () => {
      const fn = makeFn({
        name: "create",
        class_name: "Factory",
        params: [
          { name: "cls", type: "type", default_value: null, is_args: false, is_kwargs: false },
          { name: "name", type: "string", default_value: null, is_args: false, is_kwargs: false },
        ],
      });
      const result = computeFunctionIdentity("factory.ts", fn);
      expect(result.param_signature).toBe("name:string");
    });
  });

  describe("getSupportedExtensions", () => {
    it("should return an array of supported extensions", () => {
      const extensions = getSupportedExtensions();
      expect(Array.isArray(extensions)).toBe(true);
      expect(extensions.length).toBeGreaterThan(0);
    });

    it("should include Python extensions", () => {
      const extensions = getSupportedExtensions();
      expect(extensions).toContain(".py");
      expect(extensions).toContain(".pyi");
    });

    it("should include TypeScript extensions", () => {
      const extensions = getSupportedExtensions();
      expect(extensions).toContain(".ts");
      expect(extensions).toContain(".tsx");
      expect(extensions).toContain(".mts");
      expect(extensions).toContain(".cts");
    });

    it("should return unique extensions", () => {
      const extensions = getSupportedExtensions();
      const uniqueExtensions = new Set(extensions);
      expect(extensions.length).toBe(uniqueExtensions.size);
    });
  });

  describe("initParsers", () => {
    it.skip("should initialize parsers without throwing", async () => {
      await initParsers();
    });
  });

  describe("parseFileAuto", () => {
    it.skip("should parse Python files", async () => {});

    it.skip("should parse TypeScript files", async () => {});

    it("should throw error for unsupported extensions", async () => {
      await expect(parseFileAuto("file.xyz")).rejects.toThrow(/Unsupported file extension/);
    });

    it("should throw error with helpful message", async () => {
      const error = await parseFileAuto("file.json").catch((e) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain("Unsupported file extension");
    });
  });

  describe("Type Exports", () => {
    it("should export FunctionSignature type", () => {
      const sig: FunctionSignature = {
        name: "test",
        params: [],
        return_type: "void",
        decorators: [],
        is_method: false,
        is_async: false,
        class_name: null,
        start_line: 1,
        end_line: 2,
        docstring: null,
      };
      expect(sig.name).toBe("test");
    });

    it("should export FunctionParam type", () => {
      const param: FunctionParam = {
        name: "value",
        type: "string",
        default_value: null,
        is_args: false,
        is_kwargs: false,
      };
      expect(param.name).toBe("value");
    });

    it("should export FunctionIdentity type", () => {
      const identity: FunctionIdentity = {
        hash: "abc1234567890def",
        file_path: "src/index.ts",
        function_name: "myFunc",
        class_name: null,
        param_signature: "x:number",
      };
      expect(identity.hash).toHaveLength(16);
    });

    it("should export ParsedModule type", () => {
      const module: ParsedModule = {
        file_path: "test.ts",
        functions: [],
        classes: [],
        imports: [],
      };
      expect(module.file_path).toBe("test.ts");
      expect(Array.isArray(module.functions)).toBe(true);
    });

    it("should export ClassInfo type", () => {
      const classInfo: ClassInfo = {
        name: "MyClass",
        methods: [],
        decorators: [],
        start_line: 1,
        end_line: 10,
        bases: ["BaseClass"],
      };
      expect(classInfo.name).toBe("MyClass");
    });

    it("should export ImportInfo type", () => {
      const importInfo: ImportInfo = {
        module: "react",
        names: ["useState"],
        is_from: true,
        line: 1,
      };
      expect(importInfo.module).toBe("react");
    });
  });

  describe("Integration", () => {
    it("should have all exported functions defined", () => {
      expect(typeof computeFunctionIdentity).toBe("function");
      expect(typeof getSupportedExtensions).toBe("function");
      expect(typeof initParsers).toBe("function");
      expect(typeof parseFileAuto).toBe("function");
    });

    it("should compute identity for complete function", () => {
      const fn: FunctionSignature = {
        name: "complexFunc",
        params: [
          { name: "x", type: "number", default_value: null, is_args: false, is_kwargs: false },
          { name: "y", type: "string", default_value: "test", is_args: false, is_kwargs: false },
        ],
        return_type: "Promise<void>",
        decorators: ["@memoize"],
        is_method: true,
        is_async: true,
        class_name: "ServiceClass",
        start_line: 42,
        end_line: 99,
        docstring: "A complex function",
      };
      const identity = computeFunctionIdentity("services/main.ts", fn);
      expect(identity.function_name).toBe("complexFunc");
      expect(identity.class_name).toBe("ServiceClass");
    });
  });
});
