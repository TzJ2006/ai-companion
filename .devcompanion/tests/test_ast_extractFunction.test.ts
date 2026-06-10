import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initParser, parseFile } from "../../packages/ast/src/parser.js";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP_DIR = join(tmpdir(), "extractFunction-tests");
let tmpFiles: string[] = [];

async function writeTmpPython(name: string, content: string): Promise<string> {
  const filePath = join(TMP_DIR, name);
  await writeFile(filePath, content, "utf-8");
  tmpFiles.push(filePath);
  return filePath;
}

beforeAll(async () => {
  await mkdir(TMP_DIR, { recursive: true });
  await initParser();
});

afterAll(async () => {
  for (const f of tmpFiles) {
    await unlink(f).catch(() => {});
  }
});

describe("extractFunction", () => {
  it("should extract a simple function with name and no params", async () => {
    const filePath = await writeTmpPython(
      "simple.py",
      "def greet():\n    return 'hello'\n"
    );
    const result = await parseFile(filePath);

    expect(result.functions).toHaveLength(1);
    const fn = result.functions[0];
    expect(fn.name).toBe("greet");
    expect(fn.params).toHaveLength(0);
    expect(fn.return_type).toBeNull();
    expect(fn.is_method).toBe(false);
    expect(fn.is_async).toBe(false);
    expect(fn.class_name).toBeNull();
    expect(fn.decorators).toEqual([]);
  });

  it("should extract function with typed parameters", async () => {
    const filePath = await writeTmpPython(
      "typed_params.py",
      "def add(a: int, b: int) -> int:\n    return a + b\n"
    );
    const result = await parseFile(filePath);

    const fn = result.functions[0];
    expect(fn.name).toBe("add");
    expect(fn.params).toHaveLength(2);
    expect(fn.params[0].name).toBe("a");
    expect(fn.params[0].type).toBe("int");
    expect(fn.params[1].name).toBe("b");
    expect(fn.params[1].type).toBe("int");
    expect(fn.return_type).toBe("int");
  });

  it("should extract function with default parameter values", async () => {
    const filePath = await writeTmpPython(
      "defaults.py",
      "def connect(host='localhost', port=5432):\n    pass\n"
    );
    const result = await parseFile(filePath);

    const fn = result.functions[0];
    expect(fn.params).toHaveLength(2);
    expect(fn.params[0].name).toBe("host");
    expect(fn.params[0].default_value).toBe("'localhost'");
    expect(fn.params[1].name).toBe("port");
    expect(fn.params[1].default_value).toBe("5432");
  });

  it("should extract function with typed default parameters", async () => {
    const filePath = await writeTmpPython(
      "typed_defaults.py",
      "def fetch(url: str, timeout: int = 30) -> str:\n    pass\n"
    );
    const result = await parseFile(filePath);

    const fn = result.functions[0];
    expect(fn.params).toHaveLength(2);
    expect(fn.params[0].name).toBe("url");
    expect(fn.params[0].type).toBe("str");
    expect(fn.params[0].default_value).toBeNull();
    expect(fn.params[1].name).toBe("timeout");
    expect(fn.params[1].type).toBe("int");
    expect(fn.params[1].default_value).toBe("30");
  });

  it("should detect *args parameter", async () => {
    const filePath = await writeTmpPython(
      "args.py",
      "def variadic(*args):\n    pass\n"
    );
    const result = await parseFile(filePath);

    const fn = result.functions[0];
    expect(fn.params).toHaveLength(1);
    expect(fn.params[0].name).toBe("args");
    expect(fn.params[0].is_args).toBe(true);
    expect(fn.params[0].is_kwargs).toBe(false);
  });

  it("should detect **kwargs parameter", async () => {
    const filePath = await writeTmpPython(
      "kwargs.py",
      "def flexible(**kwargs):\n    pass\n"
    );
    const result = await parseFile(filePath);

    const fn = result.functions[0];
    expect(fn.params).toHaveLength(1);
    expect(fn.params[0].name).toBe("kwargs");
    expect(fn.params[0].is_args).toBe(false);
    expect(fn.params[0].is_kwargs).toBe(true);
  });

  it("should detect async functions", async () => {
    const filePath = await writeTmpPython(
      "async_fn.py",
      "async def fetch_data(url: str) -> str:\n    pass\n"
    );
    const result = await parseFile(filePath);

    const fn = result.functions[0];
    expect(fn.name).toBe("fetch_data");
    expect(fn.is_async).toBe(true);
  });

  it("should extract docstring from function body", async () => {
    const filePath = await writeTmpPython(
      "docstring.py",
      [
        "def documented():",
        '    """This function does something useful."""',
        "    return 42",
      ].join("\n") + "\n"
    );
    const result = await parseFile(filePath);

    const fn = result.functions[0];
    expect(fn.docstring).toBe("This function does something useful.");
  });

  it("should extract multiline docstring", async () => {
    const filePath = await writeTmpPython(
      "multiline_doc.py",
      [
        "def complex():",
        '    """',
        "    A multiline docstring.",
        "",
        "    With details.",
        '    """',
        "    pass",
      ].join("\n") + "\n"
    );
    const result = await parseFile(filePath);

    const fn = result.functions[0];
    expect(fn.docstring).not.toBeNull();
    expect(fn.docstring).toContain("multiline docstring");
  });

  it("should return null docstring when none present", async () => {
    const filePath = await writeTmpPython(
      "no_doc.py",
      "def bare():\n    x = 1\n    return x\n"
    );
    const result = await parseFile(filePath);

    const fn = result.functions[0];
    expect(fn.docstring).toBeNull();
  });

  it("should set correct start_line and end_line", async () => {
    const filePath = await writeTmpPython(
      "lines.py",
      [
        "x = 1",
        "",
        "def on_line_three():",
        "    return True",
        "",
      ].join("\n")
    );
    const result = await parseFile(filePath);

    const fn = result.functions[0];
    expect(fn.start_line).toBe(3);
    expect(fn.end_line).toBe(4);
  });

  it("should extract multiple top-level functions", async () => {
    const filePath = await writeTmpPython(
      "multiple.py",
      [
        "def first():",
        "    pass",
        "",
        "def second():",
        "    pass",
        "",
        "def third():",
        "    pass",
      ].join("\n") + "\n"
    );
    const result = await parseFile(filePath);

    expect(result.functions).toHaveLength(3);
    expect(result.functions.map((f) => f.name)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("should handle mixed args, kwargs and regular params", async () => {
    const filePath = await writeTmpPython(
      "mixed_params.py",
      "def mixed(a, b: int, c=10, *args, **kwargs):\n    pass\n"
    );
    const result = await parseFile(filePath);

    const fn = result.functions[0];
    expect(fn.params.length).toBeGreaterThanOrEqual(5);

    const regular = fn.params.find((p) => p.name === "a");
    expect(regular).toBeDefined();
    expect(regular!.type).toBeNull();
    expect(regular!.is_args).toBe(false);
    expect(regular!.is_kwargs).toBe(false);

    const typed = fn.params.find((p) => p.name === "b");
    expect(typed).toBeDefined();
    expect(typed!.type).toBe("int");

    const defaulted = fn.params.find((p) => p.name === "c");
    expect(defaulted).toBeDefined();
    expect(defaulted!.default_value).toBe("10");

    const args = fn.params.find((p) => p.is_args);
    expect(args).toBeDefined();
    expect(args!.name).toBe("args");

    const kwargs = fn.params.find((p) => p.is_kwargs);
    expect(kwargs).toBeDefined();
    expect(kwargs!.name).toBe("kwargs");
  });

  it("should mark methods inside a class with is_method and class_name", async () => {
    const filePath = await writeTmpPython(
      "method.py",
      [
        "class MyService:",
        "    def handle(self, request):",
        "        pass",
      ].join("\n") + "\n"
    );
    const result = await parseFile(filePath);

    expect(result.classes).toHaveLength(1);
    const method = result.classes[0].methods[0];
    expect(method.name).toBe("handle");
    expect(method.is_method).toBe(true);
    expect(method.class_name).toBe("MyService");
  });

  it("should extract decorators on a function", async () => {
    const filePath = await writeTmpPython(
      "decorated.py",
      [
        "@staticmethod",
        "@cache",
        "def cached_value():",
        "    return 42",
      ].join("\n") + "\n"
    );
    const result = await parseFile(filePath);

    const fn = result.functions[0];
    expect(fn.name).toBe("cached_value");
    expect(fn.decorators).toContain("staticmethod");
    expect(fn.decorators).toContain("cache");
  });

  it("should handle decorator with arguments", async () => {
    const filePath = await writeTmpPython(
      "decorator_args.py",
      [
        '@app.route("/api")',
        "def handler():",
        "    pass",
      ].join("\n") + "\n"
    );
    const result = await parseFile(filePath);

    const fn = result.functions[0];
    expect(fn.decorators.length).toBe(1);
    expect(fn.decorators[0]).toContain("app.route");
  });

  it("should handle function with no body statements (just pass)", async () => {
    const filePath = await writeTmpPython(
      "stub.py",
      "def stub() -> None:\n    pass\n"
    );
    const result = await parseFile(filePath);

    const fn = result.functions[0];
    expect(fn.name).toBe("stub");
    expect(fn.return_type).toBe("None");
    expect(fn.docstring).toBeNull();
  });

  it("should handle function with complex return type annotation", async () => {
    const filePath = await writeTmpPython(
      "complex_return.py",
      "def get_items() -> list[dict[str, int]]:\n    return []\n"
    );
    const result = await parseFile(filePath);

    const fn = result.functions[0];
    expect(fn.return_type).toBe("list[dict[str, int]]");
  });
});
