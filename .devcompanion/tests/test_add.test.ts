import { describe, it, expect, vi } from "vitest";
import {
  initParser,
  parseFile,
  parseSource,
  initTsParser,
  parseTsFile,
  parseTsSource,
  parseFileAuto,
  initParsers,
  getSupportedExtensions,
  computeFunctionIdentity,
} from "../../packages/ast/src/index.js";
import type {
  FunctionSignature,
  FunctionParam,
  FunctionIdentity,
  ParsedModule,
  ClassInfo,
  ImportInfo,
} from "../../packages/ast/src/index.js";

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

describe("computeFunctionIdentity", () => {
  it("should return 16-char hex hash", () => {
    const fn = makeFn({ name: "foo" });
    const result = computeFunctionIdentity("src/utils.py", fn);
    expect(result.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("should include file_path", () => {
    const fn = makeFn();
    const result = computeFunctionIdentity("src/worker.py", fn);
    expect(result.file_path).toBe("src/worker.py");
  });

  it("should include function_name", () => {
    const fn = makeFn({ name: "do_work" });
    const result = computeFunctionIdentity("a.py", fn);
    expect(result.function_name).toBe("do_work");
  });

  it("should include class_name", () => {
    const fn = makeFn({ class_name: "Worker" });
    const result = computeFunctionIdentity("a.py", fn);
    expect(result.class_name).toBe("Worker");
  });

  it("should build param_signature from params", () => {
    const fn = makeFn({
      params: [
        makeParam("x", "int"),
        makeParam("y", "str"),
      ],
    });
    const result = computeFunctionIdentity("a.py", fn);
    expect(result.param_signature).toBe("x:int,y:str");
  });

  it("should exclude self parameter", () => {
    const fn = makeFn({
      params: [
        makeParam("self"),
        makeParam("x", "int"),
      ],
    });
    const result = computeFunctionIdentity("a.py", fn);
    expect(result.param_signature).toBe("x:int");
  });

  it("should exclude cls parameter", () => {
    const fn = makeFn({
      params: [
        makeParam("cls"),
        makeParam("name", "str"),
      ],
    });
    const result = computeFunctionIdentity("a.py", fn);
    expect(result.param_signature).toBe("name:str");
  });

  it("should use any type for untyped params", () => {
    const fn = makeFn({
      params: [
        makeParam("data", null),
        makeParam("flag", null),
      ],
    });
    const result = computeFunctionIdentity("a.py", fn);
    expect(result.param_signature).toBe("data:any,flag:any");
  });

  it("should produce empty signature for no params", () => {
    const fn = makeFn({ params: [] });
    const result = computeFunctionIdentity("a.py", fn);
    expect(result.param_signature).toBe("");
  });

  it("should be deterministic", () => {
    const fn = makeFn({ name: "greet", params: [makeParam("name", "str")] });
    const r1 = computeFunctionIdentity("hello.py", fn);
    const r2 = computeFunctionIdentity("hello.py", fn);
    expect(r1.hash).toBe(r2.hash);
  });

  it("should differ for different file paths", () => {
    const fn = makeFn({ name: "greet" });
    const r1 = computeFunctionIdentity("a.py", fn);
    const r2 = computeFunctionIdentity("b.py", fn);
    expect(r1.hash).not.toBe(r2.hash);
  });

  it("should differ for different function names", () => {
    const fn1 = makeFn({ name: "foo" });
    const fn2 = makeFn({ name: "bar" });
    const r1 = computeFunctionIdentity("a.py", fn1);
    const r2 = computeFunctionIdentity("a.py", fn2);
    expect(r1.hash).not.toBe(r2.hash);
  });

  it("should differ for different parameter types", () => {
    const fn1 = makeFn({ params: [makeParam("x", "int")] });
    const fn2 = makeFn({ params: [makeParam("x", "str")] });
    const r1 = computeFunctionIdentity("a.py", fn1);
    const r2 = computeFunctionIdentity("a.py", fn2);
    expect(r1.hash).not.toBe(r2.hash);
  });

  it("should differ by class_name", () => {
    const fn1 = makeFn({ name: "run", class_name: "ClassA" });
    const fn2 = makeFn({ name: "run", class_name: "ClassB" });
    const r1 = computeFunctionIdentity("a.py", fn1);
    const r2 = computeFunctionIdentity("a.py", fn2);
    expect(r1.hash).not.toBe(r2.hash);
  });

  it("should handle null class_name", () => {
    const fn = makeFn({ name: "run", class_name: null });
    const result = computeFunctionIdentity("a.py", fn);
    expect(result.class_name).toBeNull();
    expect(result.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("should handle complex signatures", () => {
    const fn = makeFn({
      params: [
        makeParam("self"),
        makeParam("data", "dict"),
        makeParam("options", null),
        makeParam("flag", "bool"),
      ],
    });
    const result = computeFunctionIdentity("module.py", fn);
    expect(result.param_signature).toBe("data:dict,options:any,flag:bool");
  });
});

describe("getSupportedExtensions", () => {
  it("should return an array", () => {
    const exts = getSupportedExtensions();
    expect(Array.isArray(exts)).toBe(true);
    expect(exts.length).toBeGreaterThan(0);
  });

  it("should include Python extensions", () => {
    const exts = getSupportedExtensions();
    expect(exts).toContain(".py");
    expect(exts).toContain(".pyi");
  });

  it("should include TypeScript extensions", () => {
    const exts = getSupportedExtensions();
    expect(exts).toContain(".ts");
    expect(exts).toContain(".tsx");
    expect(exts).toContain(".mts");
    expect(exts).toContain(".cts");
  });

  it("should not include .js", () => {
    const exts = getSupportedExtensions();
    expect(exts).not.toContain(".js");
  });

  it("should only have dot-prefixed extensions", () => {
    const exts = getSupportedExtensions();
    for (const ext of exts) {
      expect(ext.startsWith(".")).toBe(true);
    }
  });
});

describe("Type Exports", () => {
  it("should support FunctionSignature", () => {
    const sig: FunctionSignature = {
      name: "test",
      params: [],
      return_type: null,
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

  it("should support FunctionParam", () => {
    const param: FunctionParam = {
      name: "value",
      type: "int",
      default_value: "0",
      is_args: false,
      is_kwargs: false,
    };
    expect(param.name).toBe("value");
  });

  it("should support FunctionIdentity", () => {
    const identity: FunctionIdentity = {
      hash: "abc123",
      file_path: "src/module.py",
      function_name: "helper",
      class_name: "Helper",
      param_signature: "x:int",
    };
    expect(identity.hash).toBe("abc123");
  });

  it("should support ParsedModule", () => {
    const module: ParsedModule = {
      file_path: "src/main.py",
      functions: [],
      classes: [],
      imports: [],
    };
    expect(module.file_path).toBe("src/main.py");
  });

  it("should support ClassInfo", () => {
    const classInfo: ClassInfo = {
      name: "MyClass",
      methods: [],
      decorators: [],
      start_line: 1,
      end_line: 30,
      bases: ["BaseClass"],
    };
    expect(classInfo.bases).toContain("BaseClass");
  });

  it("should support ImportInfo", () => {
    const importInfo: ImportInfo = {
      module: "os",
      names: ["path"],
      is_from: true,
      line: 1,
    };
    expect(importInfo.is_from).toBe(true);
  });
});

describe("parseFileAuto", () => {
  it("should reject unsupported extensions", async () => {
    await expect(parseFileAuto("file.rs")).rejects.toThrow("Unsupported file extension");
  });

  it.skip("should handle Python files", async () => {});
  it.skip("should handle TypeScript files", async () => {});
});

describe("Module Exports", () => {
  it("should export computeFunctionIdentity", () => {
    expect(typeof computeFunctionIdentity).toBe("function");
  });

  it("should export getSupportedExtensions", () => {
    expect(typeof getSupportedExtensions).toBe("function");
  });

  it("should export initParser", () => {
    expect(typeof initParser).toBe("function");
  });

  it("should export parseFile", () => {
    expect(typeof parseFile).toBe("function");
  });

  it("should export parseSource", () => {
    expect(typeof parseSource).toBe("function");
  });

  it("should export initTsParser", () => {
    expect(typeof initTsParser).toBe("function");
  });

  it("should export parseTsFile", () => {
    expect(typeof parseTsFile).toBe("function");
  });

  it("should export parseTsSource", () => {
    expect(typeof parseTsSource).toBe("function");
  });

  it("should export parseFileAuto", () => {
    expect(typeof parseFileAuto).toBe("function");
  });

  it("should export initParsers", () => {
    expect(typeof initParsers).toBe("function");
  });
});

describe("Parser Functions", () => {
  it.skip("initParser - requires WASM", async () => {});
  it.skip("parseSource - requires parser", () => {});
  it.skip("parseFile - requires parser and filesystem", async () => {});
  it.skip("initTsParser - requires WASM", async () => {});
  it.skip("parseTsSource - requires parser", () => {});
  it.skip("parseTsFile - requires parser and filesystem", async () => {});
  it.skip("initParsers - requires WASM", async () => {});
});
