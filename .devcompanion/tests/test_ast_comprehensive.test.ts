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

describe("computeFunctionIdentity", () => {
  const makeParam = (
    name: string,
    type: string | null = null
  ): FunctionParam => ({
    name,
    type,
    default_value: null,
    is_args: false,
    is_kwargs: false,
  });

  const makeFn = (
    overrides: Partial<FunctionSignature> = {}
  ): FunctionSignature => ({
    name: "test_func",
    params: [],
    return_type: null,
    decorators: [],
    is_method: false,
    is_async: false,
    class_name: null,
    start_line: 1,
    end_line: 10,
    docstring: null,
    ...overrides,
  });

  it("should execute without throwing", () => {
    const result = computeFunctionIdentity("src/test.py", makeFn());
    expect(result).toBeDefined();
  });

  it("should return correct type with hash property", () => {
    const result = computeFunctionIdentity("src/test.py", makeFn());
    expect(result.hash).toBeDefined();
    expect(typeof result.hash).toBe("string");
  });

  it("should generate 16-character hex hash", () => {
    const result = computeFunctionIdentity("src/test.py", makeFn());
    expect(result.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("should preserve file_path in result", () => {
    const filePath = "src/module/utils.py";
    const result = computeFunctionIdentity(filePath, makeFn());
    expect(result.file_path).toBe(filePath);
  });

  it("should preserve function_name", () => {
    const fn = makeFn({ name: "calculate_total" });
    const result = computeFunctionIdentity("src/math.py", fn);
    expect(result.function_name).toBe("calculate_total");
  });

  it("should preserve class_name for methods", () => {
    const fn = makeFn({ name: "run", class_name: "Worker" });
    const result = computeFunctionIdentity("src/worker.py", fn);
    expect(result.class_name).toBe("Worker");
  });

  it("should set class_name to null for standalone functions", () => {
    const fn = makeFn({ class_name: null });
    const result = computeFunctionIdentity("src/utils.py", fn);
    expect(result.class_name).toBeNull();
  });

  it("should build param_signature from parameters", () => {
    const fn = makeFn({
      params: [
        makeParam("x", "int"),
        makeParam("y", "str"),
      ],
    });
    const result = computeFunctionIdentity("src/test.py", fn);
    expect(result.param_signature).toContain("x:int");
    expect(result.param_signature).toContain("y:str");
  });

  it("should exclude self from param_signature", () => {
    const fn = makeFn({
      params: [
        makeParam("self"),
        makeParam("value", "int"),
      ],
      is_method: true,
    });
    const result = computeFunctionIdentity("src/test.py", fn);
    expect(result.param_signature).not.toContain("self");
    expect(result.param_signature).toContain("value:int");
  });

  it("should exclude cls from param_signature", () => {
    const fn = makeFn({
      params: [
        makeParam("cls"),
        makeParam("name", "str"),
      ],
    });
    const result = computeFunctionIdentity("src/test.py", fn);
    expect(result.param_signature).not.toContain("cls");
    expect(result.param_signature).toContain("name:str");
  });

  it("should use any type for untyped parameters", () => {
    const fn = makeFn({
      params: [makeParam("data", null)],
    });
    const result = computeFunctionIdentity("src/test.py", fn);
    expect(result.param_signature).toContain("any");
  });

  it("should produce deterministic hashes", () => {
    const fn = makeFn({ name: "greet" });
    const hash1 = computeFunctionIdentity("src/test.py", fn).hash;
    const hash2 = computeFunctionIdentity("src/test.py", fn).hash;
    expect(hash1).toBe(hash2);
  });

  it("should produce different hashes for different file paths", () => {
    const fn = makeFn({ name: "greet" });
    const hash1 = computeFunctionIdentity("src/a.py", fn).hash;
    const hash2 = computeFunctionIdentity("src/b.py", fn).hash;
    expect(hash1).not.toBe(hash2);
  });

  it("should produce different hashes for different function names", () => {
    const fn1 = makeFn({ name: "foo" });
    const fn2 = makeFn({ name: "bar" });
    const hash1 = computeFunctionIdentity("src/test.py", fn1).hash;
    const hash2 = computeFunctionIdentity("src/test.py", fn2).hash;
    expect(hash1).not.toBe(hash2);
  });

  it("should produce different hashes for different class names", () => {
    const fn1 = makeFn({ name: "run", class_name: "ClassA" });
    const fn2 = makeFn({ name: "run", class_name: "ClassB" });
    const hash1 = computeFunctionIdentity("src/test.py", fn1).hash;
    const hash2 = computeFunctionIdentity("src/test.py", fn2).hash;
    expect(hash1).not.toBe(hash2);
  });

  it("should produce different hashes for different parameters", () => {
    const fn1 = makeFn({ params: [makeParam("x", "int")] });
    const fn2 = makeFn({ params: [makeParam("x", "str")] });
    const hash1 = computeFunctionIdentity("src/test.py", fn1).hash;
    const hash2 = computeFunctionIdentity("src/test.py", fn2).hash;
    expect(hash1).not.toBe(hash2);
  });

  it("should handle functions with no parameters", () => {
    const fn = makeFn({ params: [] });
    const result = computeFunctionIdentity("src/test.py", fn);
    expect(result.param_signature).toBe("");
  });

  it("should handle complex parameter signatures", () => {
    const fn = makeFn({
      params: [
        makeParam("self"),
        makeParam("name", "str"),
        makeParam("age", "int"),
        makeParam("active", "bool"),
      ],
    });
    const result = computeFunctionIdentity("src/test.py", fn);
    expect(result.param_signature).toMatch(/name:str/);
    expect(result.param_signature).toMatch(/age:int/);
    expect(result.param_signature).toMatch(/active:bool/);
    expect(result.param_signature).not.toContain("self");
  });
});

describe("getSupportedExtensions", () => {
  it("should return an array", () => {
    const result = getSupportedExtensions();
    expect(Array.isArray(result)).toBe(true);
  });

  it("should return non-empty array", () => {
    const result = getSupportedExtensions();
    expect(result.length).toBeGreaterThan(0);
  });

  it("should return array of strings", () => {
    const result = getSupportedExtensions();
    for (const ext of result) {
      expect(typeof ext).toBe("string");
    }
  });

  it("should return strings starting with dot", () => {
    const result = getSupportedExtensions();
    for (const ext of result) {
      expect(ext.startsWith(".")).toBe(true);
    }
  });

  it("should include Python .py", () => {
    const result = getSupportedExtensions();
    expect(result).toContain(".py");
  });

  it("should include Python .pyi", () => {
    const result = getSupportedExtensions();
    expect(result).toContain(".pyi");
  });

  it("should include TypeScript .ts", () => {
    const result = getSupportedExtensions();
    expect(result).toContain(".ts");
  });

  it("should include TypeScript .tsx", () => {
    const result = getSupportedExtensions();
    expect(result).toContain(".tsx");
  });

  it("should include TypeScript .mts", () => {
    const result = getSupportedExtensions();
    expect(result).toContain(".mts");
  });

  it("should include TypeScript .cts", () => {
    const result = getSupportedExtensions();
    expect(result).toContain(".cts");
  });

  it("should not include .js", () => {
    const result = getSupportedExtensions();
    expect(result).not.toContain(".js");
  });

  it("should not include other languages", () => {
    const result = getSupportedExtensions();
    expect(result).not.toContain(".go");
    expect(result).not.toContain(".rs");
    expect(result).not.toContain(".java");
  });

  it("should be consistent across calls", () => {
    const result1 = getSupportedExtensions();
    const result2 = getSupportedExtensions();
    expect(result1).toEqual(result2);
  });
});

describe("Type Exports", () => {
  it("should export FunctionIdentity type", () => {
    const identity: FunctionIdentity = {
      hash: "abcdef1234567890",
      file_path: "src/module.py",
      function_name: "my_function",
      class_name: "MyClass",
      param_signature: "x:int,y:str",
    };
    expect(identity.hash).toBe("abcdef1234567890");
  });

  it("should export FunctionSignature type", () => {
    const sig: FunctionSignature = {
      name: "test",
      params: [],
      return_type: "int",
      decorators: [],
      is_method: false,
      is_async: false,
      class_name: null,
      start_line: 1,
      end_line: 5,
      docstring: null,
    };
    expect(sig.name).toBe("test");
  });

  it("should export FunctionParam type", () => {
    const param: FunctionParam = {
      name: "value",
      type: "str",
      default_value: null,
      is_args: false,
      is_kwargs: false,
    };
    expect(param.name).toBe("value");
  });

  it("should export ParsedModule type", () => {
    const module: ParsedModule = {
      file_path: "src/utils.py",
      functions: [],
      classes: [],
      imports: [],
    };
    expect(module.file_path).toBe("src/utils.py");
  });

  it("should export ClassInfo type", () => {
    const cls: ClassInfo = {
      name: "Worker",
      methods: [],
      decorators: [],
      start_line: 5,
      end_line: 30,
      bases: ["Thread"],
    };
    expect(cls.name).toBe("Worker");
  });

  it("should export ImportInfo type", () => {
    const imp: ImportInfo = {
      module: "os",
      names: ["path"],
      is_from: true,
      line: 1,
    };
    expect(imp.module).toBe("os");
  });
});

describe("Module exports", () => {
  it("should export computeFunctionIdentity", () => {
    expect(typeof computeFunctionIdentity).toBe("function");
  });

  it("should export getSupportedExtensions", () => {
    expect(typeof getSupportedExtensions).toBe("function");
  });

  it("should export initParsers", () => {
    expect(typeof initParsers).toBe("function");
  });

  it("should export parseFileAuto", () => {
    expect(typeof parseFileAuto).toBe("function");
  });
});

describe("initParsers", () => {
  it.skip("requires tree-sitter WASM binary", () => {});
});

describe("parseFileAuto", () => {
  it.skip("requires tree-sitter WASM and file system access", () => {});
});
