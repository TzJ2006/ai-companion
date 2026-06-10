import { describe, it, expect } from "vitest";
import { computeFunctionIdentity } from "../../packages/ast/src/identity.js";
import type { FunctionSignature, FunctionParam } from "../../packages/ast/src/types.js";

describe("computeFunctionIdentity", () => {
  const makeFn = (overrides: Partial<FunctionSignature> = {}): FunctionSignature => ({
    name: "doStuff",
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

  const makeParam = (overrides: Partial<FunctionParam> = {}): FunctionParam => ({
    name: "param",
    type: "string",
    default_value: null,
    is_args: false,
    is_kwargs: false,
    ...overrides,
  });

  describe("basic structure and return type", () => {
    it("should execute without throwing", () => {
      const fn = makeFn({ name: "basic" });
      expect(() => computeFunctionIdentity("test.py", fn)).not.toThrow();
    });

    it("should return FunctionIdentity with all required fields", () => {
      const fn = makeFn({ name: "complete" });
      const result = computeFunctionIdentity("app.py", fn);

      expect(result).toHaveProperty("hash");
      expect(result).toHaveProperty("file_path");
      expect(result).toHaveProperty("function_name");
      expect(result).toHaveProperty("class_name");
      expect(result).toHaveProperty("param_signature");
    });

    it("should have correct field types", () => {
      const fn = makeFn({ name: "typed" });
      const result = computeFunctionIdentity("mod.py", fn);

      expect(typeof result.hash).toBe("string");
      expect(typeof result.file_path).toBe("string");
      expect(typeof result.function_name).toBe("string");
      expect(result.class_name === null || typeof result.class_name === "string").toBe(true);
      expect(typeof result.param_signature).toBe("string");
    });
  });

  describe("hash generation", () => {
    it("should produce a 16-character hexadecimal hash", () => {
      const fn = makeFn({ name: "hashed" });
      const result = computeFunctionIdentity("file.py", fn);

      expect(result.hash).toHaveLength(16);
      expect(result.hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it("should produce deterministic hash for identical inputs", () => {
      const fn = makeFn({ name: "deterministic", params: [makeParam({ name: "x", type: "int" })] });
      const r1 = computeFunctionIdentity("stable.py", fn);
      const r2 = computeFunctionIdentity("stable.py", fn);

      expect(r1.hash).toBe(r2.hash);
    });

    it("should produce different hashes for different file paths", () => {
      const fn = makeFn({ name: "same" });
      const r1 = computeFunctionIdentity("path/a.py", fn);
      const r2 = computeFunctionIdentity("path/b.py", fn);

      expect(r1.hash).not.toBe(r2.hash);
    });

    it("should produce different hashes for different function names", () => {
      const fn1 = makeFn({ name: "func1" });
      const fn2 = makeFn({ name: "func2" });
      const r1 = computeFunctionIdentity("mod.py", fn1);
      const r2 = computeFunctionIdentity("mod.py", fn2);

      expect(r1.hash).not.toBe(r2.hash);
    });

    it("should produce different hashes for different class names", () => {
      const fn1 = makeFn({ name: "method", class_name: "ClassA" });
      const fn2 = makeFn({ name: "method", class_name: "ClassB" });
      const r1 = computeFunctionIdentity("module.py", fn1);
      const r2 = computeFunctionIdentity("module.py", fn2);

      expect(r1.hash).not.toBe(r2.hash);
    });

    it("should produce different hashes for different parameter signatures", () => {
      const fn1 = makeFn({ name: "calc", params: [makeParam({ name: "a", type: "int" })] });
      const fn2 = makeFn({ name: "calc", params: [makeParam({ name: "b", type: "str" })] });
      const r1 = computeFunctionIdentity("math.py", fn1);
      const r2 = computeFunctionIdentity("math.py", fn2);

      expect(r1.hash).not.toBe(r2.hash);
    });

    it("should be case-sensitive in hash generation", () => {
      const fn1 = makeFn({ name: "MyFunc" });
      const fn2 = makeFn({ name: "myfunc" });
      const r1 = computeFunctionIdentity("mod.py", fn1);
      const r2 = computeFunctionIdentity("mod.py", fn2);

      expect(r1.hash).not.toBe(r2.hash);
    });
  });

  describe("file path and function name preservation", () => {
    it("should correctly set file_path from input", () => {
      const fn = makeFn({ name: "test" });
      const result = computeFunctionIdentity("src/utils.py", fn);

      expect(result.file_path).toBe("src/utils.py");
    });

    it("should correctly set function_name from input", () => {
      const fn = makeFn({ name: "myFunction" });
      const result = computeFunctionIdentity("app.py", fn);

      expect(result.function_name).toBe("myFunction");
    });

    it("should handle absolute file paths", () => {
      const fn = makeFn({ name: "test" });
      const result = computeFunctionIdentity("/absolute/path/file.py", fn);

      expect(result.file_path).toBe("/absolute/path/file.py");
    });

    it("should handle relative file paths with multiple segments", () => {
      const fn = makeFn({ name: "test" });
      const result = computeFunctionIdentity("../src/sub/file.py", fn);

      expect(result.file_path).toBe("../src/sub/file.py");
    });
  });

  describe("class name handling", () => {
    it("should set class_name to null when not provided", () => {
      const fn = makeFn({ name: "function", class_name: null });
      const result = computeFunctionIdentity("mod.py", fn);

      expect(result.class_name).toBeNull();
    });

    it("should preserve class_name when provided", () => {
      const fn = makeFn({ name: "method", class_name: "MyClass" });
      const result = computeFunctionIdentity("mod.py", fn);

      expect(result.class_name).toBe("MyClass");
    });

    it("should handle nested class names", () => {
      const fn = makeFn({ name: "method", class_name: "Outer.Inner" });
      const result = computeFunctionIdentity("mod.py", fn);

      expect(result.class_name).toBe("Outer.Inner");
    });

    it("should produce different hashes when class_name changes from null to value", () => {
      const fn1 = makeFn({ name: "method", class_name: null });
      const fn2 = makeFn({ name: "method", class_name: "SomeClass" });
      const r1 = computeFunctionIdentity("mod.py", fn1);
      const r2 = computeFunctionIdentity("mod.py", fn2);

      expect(r1.hash).not.toBe(r2.hash);
    });
  });

  describe("parameter signature generation", () => {
    it("should produce empty string for no parameters", () => {
      const fn = makeFn({ name: "noParams", params: [] });
      const result = computeFunctionIdentity("util.py", fn);

      expect(result.param_signature).toBe("");
    });

    it("should include parameter name and type separated by colon", () => {
      const fn = makeFn({
        name: "single",
        params: [makeParam({ name: "value", type: "int" })],
      });
      const result = computeFunctionIdentity("util.py", fn);

      expect(result.param_signature).toBe("value:int");
    });

    it("should join multiple parameters with commas", () => {
      const fn = makeFn({
        name: "multi",
        params: [
          makeParam({ name: "a", type: "int" }),
          makeParam({ name: "b", type: "str" }),
          makeParam({ name: "c", type: "float" }),
        ],
      });
      const result = computeFunctionIdentity("math.py", fn);

      expect(result.param_signature).toBe("a:int,b:str,c:float");
    });

    it("should use 'any' when parameter type is null", () => {
      const fn = makeFn({
        name: "untyped",
        params: [makeParam({ name: "data", type: null })],
      });
      const result = computeFunctionIdentity("util.py", fn);

      expect(result.param_signature).toBe("data:any");
    });

    it("should use 'any' when parameter type is undefined", () => {
      const fn = makeFn({
        name: "untyped",
        params: [{ name: "data", type: undefined as any }],
      });
      const result = computeFunctionIdentity("util.py", fn);

      expect(result.param_signature).toBe("data:any");
    });
  });

  describe("self and cls parameter filtering", () => {
    it("should filter out 'self' parameter from signature", () => {
      const fn = makeFn({
        name: "method",
        class_name: "MyClass",
        params: [
          makeParam({ name: "self", type: "MyClass" }),
          makeParam({ name: "arg", type: "str" }),
        ],
      });
      const result = computeFunctionIdentity("mod.py", fn);

      expect(result.param_signature).toBe("arg:str");
    });

    it("should filter out 'cls' parameter from signature", () => {
      const fn = makeFn({
        name: "classMethod",
        class_name: "MyClass",
        params: [
          makeParam({ name: "cls", type: "type" }),
          makeParam({ name: "name", type: "str" }),
        ],
      });
      const result = computeFunctionIdentity("mod.py", fn);

      expect(result.param_signature).toBe("name:str");
    });

    it("should filter both self and cls if present", () => {
      const fn = makeFn({
        name: "mixed",
        params: [
          makeParam({ name: "self", type: "X" }),
          makeParam({ name: "x", type: "int" }),
          makeParam({ name: "cls", type: "Y" }),
          makeParam({ name: "y", type: "str" }),
        ],
      });
      const result = computeFunctionIdentity("mod.py", fn);

      expect(result.param_signature).toBe("x:int,y:str");
    });

    it("should only filter 'self' and 'cls' parameters, not others named similarly", () => {
      const fn = makeFn({
        name: "func",
        params: [
          makeParam({ name: "self_value", type: "int" }),
          makeParam({ name: "classify", type: "str" }),
        ],
      });
      const result = computeFunctionIdentity("mod.py", fn);

      expect(result.param_signature).toBe("self_value:int,classify:str");
    });

    it("should handle method with only self parameter", () => {
      const fn = makeFn({
        name: "init",
        class_name: "Base",
        params: [makeParam({ name: "self", type: "Base" })],
      });
      const result = computeFunctionIdentity("base.py", fn);

      expect(result.param_signature).toBe("");
    });

    it("should handle classmethod with only cls parameter", () => {
      const fn = makeFn({
        name: "create",
        class_name: "Factory",
        params: [makeParam({ name: "cls", type: "type" })],
      });
      const result = computeFunctionIdentity("factory.py", fn);

      expect(result.param_signature).toBe("");
    });
  });

  describe("edge cases and special characters", () => {
    it("should handle file paths with special characters", () => {
      const fn = makeFn({ name: "test" });
      const result = computeFunctionIdentity("path-with-dash/file_name.py", fn);

      expect(result.file_path).toBe("path-with-dash/file_name.py");
    });

    it("should handle function names with underscores and numbers", () => {
      const fn = makeFn({ name: "_private_func_2" });
      const result = computeFunctionIdentity("mod.py", fn);

      expect(result.function_name).toBe("_private_func_2");
    });

    it("should handle parameter types with complex generic syntax", () => {
      const fn = makeFn({
        name: "process",
        params: [
          makeParam({ name: "items", type: "List[Dict[str, Any]]" }),
        ],
      });
      const result = computeFunctionIdentity("util.py", fn);

      expect(result.param_signature).toBe("items:List[Dict[str, Any]]");
    });

    it("should handle empty file path", () => {
      const fn = makeFn({ name: "test" });
      const result = computeFunctionIdentity("", fn);

      expect(result.file_path).toBe("");
      expect(result.hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it("should handle parameter name with special characters", () => {
      const fn = makeFn({
        name: "func",
        params: [
          makeParam({ name: "arg_1", type: "str" }),
          makeParam({ name: "arg_2", type: "int" }),
        ],
      });
      const result = computeFunctionIdentity("mod.py", fn);

      expect(result.param_signature).toBe("arg_1:str,arg_2:int");
    });

    it("should preserve type annotation casing", () => {
      const fn = makeFn({
        name: "func",
        params: [
          makeParam({ name: "x", type: "MyCustomType" }),
          makeParam({ name: "y", type: "CONSTANT" }),
        ],
      });
      const result = computeFunctionIdentity("mod.py", fn);

      expect(result.param_signature).toBe("x:MyCustomType,y:CONSTANT");
    });
  });

  describe("real-world scenarios", () => {
    it("should handle Python method with self and typed parameters", () => {
      const fn = makeFn({
        name: "process_data",
        class_name: "DataProcessor",
        params: [
          makeParam({ name: "self", type: "DataProcessor" }),
          makeParam({ name: "input_data", type: "dict" }),
          makeParam({ name: "validate", type: "bool" }),
        ],
      });
      const result = computeFunctionIdentity("processors/data.py", fn);

      expect(result.function_name).toBe("process_data");
      expect(result.class_name).toBe("DataProcessor");
      expect(result.param_signature).toBe("input_data:dict,validate:bool");
      expect(result.hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it("should handle function without class", () => {
      const fn = makeFn({
        name: "calculate",
        class_name: null,
        params: [
          makeParam({ name: "x", type: "float" }),
          makeParam({ name: "y", type: "float" }),
        ],
      });
      const result = computeFunctionIdentity("utils/math.py", fn);

      expect(result.class_name).toBeNull();
      expect(result.param_signature).toBe("x:float,y:float");
    });

    it("should handle static method signature", () => {
      const fn = makeFn({
        name: "from_json",
        class_name: "Model",
        params: [
          makeParam({ name: "data", type: "str" }),
        ],
      });
      const result = computeFunctionIdentity("models/base.py", fn);

      expect(result.param_signature).toBe("data:str");
    });

    it("should handle untyped function with multiple parameters", () => {
      const fn = makeFn({
        name: "combine",
        params: [
          makeParam({ name: "a", type: null }),
          makeParam({ name: "b", type: null }),
          makeParam({ name: "c", type: null }),
        ],
      });
      const result = computeFunctionIdentity("util.py", fn);

      expect(result.param_signature).toBe("a:any,b:any,c:any");
    });
  });

  describe("hash stability and collision resistance", () => {
    it("should produce stable hash across multiple invocations", () => {
      const fn = makeFn({
        name: "stable",
        params: [makeParam({ name: "arg", type: "string" })],
      });
      const hashes = Array(5)
        .fill(null)
        .map(() => computeFunctionIdentity("file.py", fn).hash);

      const hashSet = new Set(hashes);
      expect(hashSet.size).toBe(1);
    });

    it("should have minimal collision with similar functions", () => {
      const baseFn = makeFn({ name: "func", params: [makeParam({ name: "x", type: "int" })] });
      const r1 = computeFunctionIdentity("a.py", baseFn);
      const r2 = computeFunctionIdentity("a.py", { ...baseFn, name: "func" });
      const r3 = computeFunctionIdentity("a.py", {
        ...baseFn,
        params: [makeParam({ name: "x", type: "int" })],
      });

      expect(r1.hash).toBe(r2.hash);
      expect(r1.hash).toBe(r3.hash);
    });
  });
});
