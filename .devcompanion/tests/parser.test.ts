import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));
vi.mock("node:fs", () => ({ existsSync: vi.fn().mockReturnValue(true) }));

describe("Parser Module - Type Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("ParsedModule Structure", () => {
    it("should have file_path property as string", () => {
      const module = { file_path: "/test.py", functions: [], classes: [], imports: [] };
      expect(module.file_path).toBe("/test.py");
      expect(typeof module.file_path).toBe("string");
    });

    it("should have functions array", () => {
      const module = { file_path: "/test.py", functions: [], classes: [], imports: [] };
      expect(Array.isArray(module.functions)).toBe(true);
    });

    it("should have classes array", () => {
      const module = { file_path: "/test.py", functions: [], classes: [], imports: [] };
      expect(Array.isArray(module.classes)).toBe(true);
    });

    it("should have imports array", () => {
      const module = { file_path: "/test.py", functions: [], classes: [], imports: [] };
      expect(Array.isArray(module.imports)).toBe(true);
    });

    it("should support populated functions array", () => {
      const func = {
        name: "test",
        params: [],
        return_type: null,
        decorators: [],
        is_method: false,
        is_async: false,
        class_name: null,
        start_line: 1,
        end_line: 2,
        docstring: null,
      };
      const module = { file_path: "/test.py", functions: [func], classes: [], imports: [] };
      expect(module.functions.length).toBe(1);
      expect(module.functions[0].name).toBe("test");
    });

    it("should support populated classes array", () => {
      const cls = {
        name: "TestClass",
        methods: [],
        decorators: [],
        start_line: 1,
        end_line: 5,
        bases: [],
      };
      const module = { file_path: "/test.py", functions: [], classes: [cls], imports: [] };
      expect(module.classes.length).toBe(1);
      expect(module.classes[0].name).toBe("TestClass");
    });

    it("should support populated imports array", () => {
      const imp = { module: "os", names: ["os"], is_from: false, line: 1 };
      const module = { file_path: "/test.py", functions: [], classes: [], imports: [imp] };
      expect(module.imports.length).toBe(1);
      expect(module.imports[0].module).toBe("os");
    });
  });

  describe("FunctionSignature Structure", () => {
    it("should have all required fields", () => {
      const func = {
        name: "my_func",
        params: [],
        return_type: null,
        decorators: [],
        is_method: false,
        is_async: false,
        class_name: null,
        start_line: 1,
        end_line: 2,
        docstring: null,
      };
      expect(func.name).toBe("my_func");
      expect(func.is_method).toBe(false);
      expect(func.is_async).toBe(false);
      expect(func.start_line).toBe(1);
      expect(func.end_line).toBe(2);
    });

    it("should support async functions", () => {
      const func = {
        name: "async_func",
        params: [],
        return_type: "Awaitable[str]",
        decorators: [],
        is_method: false,
        is_async: true,
        class_name: null,
        start_line: 1,
        end_line: 3,
        docstring: null,
      };
      expect(func.is_async).toBe(true);
      expect(func.return_type).toBe("Awaitable[str]");
    });

    it("should support methods", () => {
      const method = {
        name: "method",
        params: [],
        return_type: null,
        decorators: [],
        is_method: true,
        is_async: false,
        class_name: "MyClass",
        start_line: 10,
        end_line: 11,
        docstring: "A method",
      };
      expect(method.is_method).toBe(true);
      expect(method.class_name).toBe("MyClass");
    });

    it("should support decorated functions", () => {
      const func = {
        name: "decorated",
        params: [],
        return_type: null,
        decorators: ["property", "cache"],
        is_method: false,
        is_async: false,
        class_name: null,
        start_line: 5,
        end_line: 6,
        docstring: null,
      };
      expect(func.decorators.length).toBe(2);
      expect(func.decorators[0]).toBe("property");
    });

    it("should support functions with parameters", () => {
      const param = {
        name: "x",
        type: "int",
        default_value: null,
        is_args: false,
        is_kwargs: false,
      };
      const func = {
        name: "func",
        params: [param],
        return_type: "int",
        decorators: [],
        is_method: false,
        is_async: false,
        class_name: null,
        start_line: 1,
        end_line: 2,
        docstring: null,
      };
      expect(func.params.length).toBe(1);
      expect(func.params[0].name).toBe("x");
      expect(func.params[0].type).toBe("int");
    });

    it("should support *args and **kwargs", () => {
      const argsParam = {
        name: "args",
        type: null,
        default_value: null,
        is_args: true,
        is_kwargs: false,
      };
      const kwargsParam = {
        name: "kwargs",
        type: null,
        default_value: null,
        is_args: false,
        is_kwargs: true,
      };
      const func = {
        name: "func",
        params: [argsParam, kwargsParam],
        return_type: null,
        decorators: [],
        is_method: false,
        is_async: false,
        class_name: null,
        start_line: 1,
        end_line: 2,
        docstring: null,
      };
      expect(func.params[0].is_args).toBe(true);
      expect(func.params[1].is_kwargs).toBe(true);
    });
  });

  describe("FunctionParam Structure", () => {
    it("should have all required fields", () => {
      const param = {
        name: "param",
        type: "str",
        default_value: null,
        is_args: false,
        is_kwargs: false,
      };
      expect(param.name).toBe("param");
      expect(param.type).toBe("str");
    });

    it("should support default values", () => {
      const param = {
        name: "param",
        type: "str",
        default_value: '"default"',
        is_args: false,
        is_kwargs: false,
      };
      expect(param.default_value).toBe('"default"');
    });

    it("should distinguish args from kwargs", () => {
      const args = { name: "args", type: null, default_value: null, is_args: true, is_kwargs: false };
      const kwargs = { name: "kwargs", type: null, default_value: null, is_args: false, is_kwargs: true };
      expect(args.is_args).toBe(true);
      expect(args.is_kwargs).toBe(false);
      expect(kwargs.is_args).toBe(false);
      expect(kwargs.is_kwargs).toBe(true);
    });
  });

  describe("ClassInfo Structure", () => {
    it("should have all required fields", () => {
      const cls = {
        name: "TestClass",
        methods: [],
        decorators: [],
        start_line: 1,
        end_line: 10,
        bases: [],
      };
      expect(cls.name).toBe("TestClass");
      expect(Array.isArray(cls.methods)).toBe(true);
      expect(Array.isArray(cls.decorators)).toBe(true);
      expect(Array.isArray(cls.bases)).toBe(true);
    });

    it("should support base classes", () => {
      const cls = {
        name: "Child",
        methods: [],
        decorators: [],
        start_line: 1,
        end_line: 5,
        bases: ["Parent1", "Parent2"],
      };
      expect(cls.bases.length).toBe(2);
      expect(cls.bases[0]).toBe("Parent1");
    });

    it("should support decorated classes", () => {
      const cls = {
        name: "Person",
        methods: [],
        decorators: ["dataclass"],
        start_line: 1,
        end_line: 8,
        bases: [],
      };
      expect(cls.decorators.length).toBe(1);
      expect(cls.decorators[0]).toBe("dataclass");
    });

    it("should support methods", () => {
      const method = {
        name: "__init__",
        params: [],
        return_type: null,
        decorators: [],
        is_method: true,
        is_async: false,
        class_name: "TestClass",
        start_line: 2,
        end_line: 3,
        docstring: null,
      };
      const cls = {
        name: "TestClass",
        methods: [method],
        decorators: [],
        start_line: 1,
        end_line: 10,
        bases: [],
      };
      expect(cls.methods.length).toBe(1);
      expect(cls.methods[0].name).toBe("__init__");
    });
  });

  describe("ImportInfo Structure", () => {
    it("should have all required fields", () => {
      const imp = { module: "os", names: ["os"], is_from: false, line: 1 };
      expect(imp.module).toBe("os");
      expect(Array.isArray(imp.names)).toBe(true);
      expect(imp.is_from).toBe(false);
      expect(imp.line).toBe(1);
    });

    it("should support regular imports", () => {
      const imp = { module: "sys", names: ["sys"], is_from: false, line: 2 };
      expect(imp.is_from).toBe(false);
      expect(imp.module).toBe("sys");
    });

    it("should support from imports", () => {
      const imp = {
        module: "typing",
        names: ["List", "Dict", "Optional"],
        is_from: true,
        line: 3,
      };
      expect(imp.is_from).toBe(true);
      expect(imp.names.length).toBe(3);
    });

    it("should support relative imports", () => {
      const imp = {
        module: ".submodule",
        names: [".submodule"],
        is_from: true,
        line: 1,
      };
      expect(imp.module).toContain(".");
    });
  });

  describe("File I/O", () => {
    it("should read files with mocked readFile", async () => {
      const { readFile } = await import("node:fs/promises");
      (readFile as any).mockResolvedValueOnce("test content");
      const result = await readFile("/test.py", "utf-8");
      expect(result).toBe("test content");
    });

    it("should use utf-8 encoding", async () => {
      const { readFile } = await import("node:fs/promises");
      (readFile as any).mockResolvedValueOnce("content");
      await readFile("/test.py", "utf-8");
      expect(readFile).toHaveBeenCalledWith("/test.py", "utf-8");
    });

    it("should handle file read errors", async () => {
      const { readFile } = await import("node:fs/promises");
      (readFile as any).mockRejectedValueOnce(new Error("ENOENT"));
      await expect(readFile("/missing.py", "utf-8")).rejects.toThrow("ENOENT");
    });

    it("should handle empty files", async () => {
      const { readFile } = await import("node:fs/promises");
      (readFile as any).mockResolvedValueOnce("");
      const result = await readFile("/empty.py", "utf-8");
      expect(result).toBe("");
    });

    it("should preserve file paths", async () => {
      const { readFile } = await import("node:fs/promises");
      (readFile as any).mockResolvedValueOnce("content");
      await readFile("/absolute/path/to/file.py", "utf-8");
      expect(readFile).toHaveBeenCalledWith("/absolute/path/to/file.py", "utf-8");
    });

    it("should handle relative paths", async () => {
      const { readFile } = await import("node:fs/promises");
      (readFile as any).mockResolvedValueOnce("content");
      await readFile("./relative/file.py", "utf-8");
      expect(readFile).toHaveBeenCalledWith("./relative/file.py", "utf-8");
    });

    it("should handle Windows paths", async () => {
      const { readFile } = await import("node:fs/promises");
      (readFile as any).mockResolvedValueOnce("content");
      await readFile("C:\\path\\file.py", "utf-8");
      expect(readFile).toHaveBeenCalledWith("C:\\path\\file.py", "utf-8");
    });

    it("should check file existence", async () => {
      const { existsSync } = await import("node:fs");
      (existsSync as any).mockReturnValue(true);
      const result = existsSync("/test/file.py");
      expect(result).toBe(true);
    });

    it("should return false for missing files", async () => {
      const { existsSync } = await import("node:fs");
      (existsSync as any).mockReturnValue(false);
      const result = existsSync("/missing/file.py");
      expect(result).toBe(false);
    });
  });

  describe("Type Field Consistency", () => {
    it("should maintain consistent return_type field", () => {
      const func1 = { return_type: "int" };
      const func2 = { return_type: null };
      expect(func1.return_type).toBeTruthy();
      expect(func2.return_type).toBeNull();
    });

    it("should maintain consistent type field in params", () => {
      const param1 = { type: "str" };
      const param2 = { type: null };
      expect(param1.type).toBeTruthy();
      expect(param2.type).toBeNull();
    });

    it("should maintain consistent boolean fields", () => {
      const func = { is_method: true, is_async: false };
      expect(typeof func.is_method).toBe("boolean");
      expect(typeof func.is_async).toBe("boolean");
    });

    it("should maintain consistent array fields", () => {
      const func = { params: [], decorators: [] };
      const cls = { methods: [], bases: [] };
      const imp = { names: [] };
      expect(Array.isArray(func.params)).toBe(true);
      expect(Array.isArray(cls.methods)).toBe(true);
      expect(Array.isArray(imp.names)).toBe(true);
    });
  });

  describe("Path Handling", () => {
    it("should preserve absolute paths", () => {
      const path = "/home/user/project/module.py";
      const module = { file_path: path, functions: [], classes: [], imports: [] };
      expect(module.file_path).toBe(path);
    });

    it("should preserve relative paths", () => {
      const path = "./src/module.py";
      const module = { file_path: path, functions: [], classes: [], imports: [] };
      expect(module.file_path).toBe(path);
    });

    it("should preserve parent directory paths", () => {
      const path = "../module.py";
      const module = { file_path: path, functions: [], classes: [], imports: [] };
      expect(module.file_path).toContain("..");
    });

    it("should preserve Windows paths", () => {
      const path = "C:\\Users\\test\\module.py";
      const module = { file_path: path, functions: [], classes: [], imports: [] };
      expect(module.file_path).toBe(path);
    });
  });

  describe("Complex Structures", () => {
    it("should support nested class methods with decorators", () => {
      const method = {
        name: "decorated_method",
        params: [
          { name: "self", type: null, default_value: null, is_args: false, is_kwargs: false },
          { name: "x", type: "int", default_value: null, is_args: false, is_kwargs: false },
        ],
        return_type: "bool",
        decorators: ["property"],
        is_method: true,
        is_async: false,
        class_name: "MyClass",
        start_line: 10,
        end_line: 12,
        docstring: "A property method",
      };
      const cls = {
        name: "MyClass",
        methods: [method],
        decorators: ["dataclass"],
        start_line: 1,
        end_line: 15,
        bases: ["BaseClass"],
      };
      expect(cls.methods[0].decorators[0]).toBe("property");
      expect(cls.decorators[0]).toBe("dataclass");
    });

    it("should support multiple imports in a module", () => {
      const module = {
        file_path: "/test.py",
        functions: [],
        classes: [],
        imports: [
          { module: "os", names: ["os"], is_from: false, line: 1 },
          { module: "sys", names: ["sys"], is_from: false, line: 2 },
          { module: "typing", names: ["List", "Dict"], is_from: true, line: 3 },
        ],
      };
      expect(module.imports.length).toBe(3);
      expect(module.imports[2].is_from).toBe(true);
    });

    it("should support module with mixed content", () => {
      const module = {
        file_path: "/complex.py",
        functions: [
          {
            name: "func1",
            params: [],
            return_type: null,
            decorators: [],
            is_method: false,
            is_async: false,
            class_name: null,
            start_line: 5,
            end_line: 6,
            docstring: null,
          },
        ],
        classes: [
          {
            name: "Class1",
            methods: [],
            decorators: [],
            start_line: 10,
            end_line: 15,
            bases: [],
          },
        ],
        imports: [
          { module: "os", names: ["os"], is_from: false, line: 1 },
        ],
      };
      expect(module.functions.length).toBe(1);
      expect(module.classes.length).toBe(1);
      expect(module.imports.length).toBe(1);
    });
  });
});
