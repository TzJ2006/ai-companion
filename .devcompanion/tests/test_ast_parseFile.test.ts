import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { initParser, parseFile } from "../../packages/ast/src/parser.js";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP_DIR = join(tmpdir(), "parseFile-tests");
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

describe("parseFile", () => {
  it("should return a ParsedModule with correct file_path", async () => {
    const filePath = await writeTmpPython("identity.py", "x = 1\n");
    const result = await parseFile(filePath);

    expect(result.file_path).toBe(filePath);
    expect(result.functions).toEqual([]);
    expect(result.classes).toEqual([]);
  });

  it("should extract top-level import statements", async () => {
    const filePath = await writeTmpPython(
      "imports.py",
      ["import os", "import sys", ""].join("\n")
    );
    const result = await parseFile(filePath);

    expect(result.imports).toHaveLength(2);
    expect(result.imports[0].module).toBe("os");
    expect(result.imports[0].is_from).toBe(false);
    expect(result.imports[0].line).toBe(1);
    expect(result.imports[1].module).toBe("sys");
    expect(result.imports[1].line).toBe(2);
  });

  it("should extract from-import statements", async () => {
    const filePath = await writeTmpPython(
      "from_imports.py",
      ["from typing import Optional, List", "from os.path import join, exists", ""].join("\n")
    );
    const result = await parseFile(filePath);

    expect(result.imports).toHaveLength(2);
    expect(result.imports[0].module).toBe("typing");
    expect(result.imports[0].is_from).toBe(true);
    expect(result.imports[0].names).toContain("Optional");
    expect(result.imports[0].names).toContain("List");
    expect(result.imports[1].module).toBe("os.path");
    expect(result.imports[1].names).toContain("join");
    expect(result.imports[1].names).toContain("exists");
  });

  it("should extract top-level functions", async () => {
    const filePath = await writeTmpPython(
      "functions.py",
      [
        "def add(a: int, b: int) -> int:",
        "    return a + b",
        "",
        "def subtract(a: int, b: int) -> int:",
        "    return a - b",
        "",
      ].join("\n")
    );
    const result = await parseFile(filePath);

    expect(result.functions).toHaveLength(2);
    expect(result.functions[0].name).toBe("add");
    expect(result.functions[0].is_method).toBe(false);
    expect(result.functions[0].class_name).toBeNull();
    expect(result.functions[1].name).toBe("subtract");
  });

  it("should extract classes with methods", async () => {
    const filePath = await writeTmpPython(
      "classes.py",
      [
        "class Calculator:",
        "    def __init__(self, precision: int = 2):",
        "        self.precision = precision",
        "",
        "    def add(self, a: float, b: float) -> float:",
        "        return round(a + b, self.precision)",
        "",
      ].join("\n")
    );
    const result = await parseFile(filePath);

    expect(result.classes).toHaveLength(1);
    const cls = result.classes[0];
    expect(cls.name).toBe("Calculator");
    expect(cls.methods).toHaveLength(2);
    expect(cls.methods[0].name).toBe("__init__");
    expect(cls.methods[0].is_method).toBe(true);
    expect(cls.methods[0].class_name).toBe("Calculator");
    expect(cls.methods[1].name).toBe("add");
  });

  it("should extract class bases (inheritance)", async () => {
    const filePath = await writeTmpPython(
      "inheritance.py",
      [
        "class Animal:",
        "    pass",
        "",
        "class Dog(Animal):",
        "    def bark(self):",
        "        pass",
        "",
      ].join("\n")
    );
    const result = await parseFile(filePath);

    expect(result.classes).toHaveLength(2);
    expect(result.classes[0].name).toBe("Animal");
    expect(result.classes[0].bases).toEqual([]);
    expect(result.classes[1].name).toBe("Dog");
    expect(result.classes[1].bases).toContain("Animal");
  });

  it("should extract decorated functions at module level", async () => {
    const filePath = await writeTmpPython(
      "decorated_module.py",
      [
        "@app.route('/health')",
        "def health_check():",
        "    return 'ok'",
        "",
      ].join("\n")
    );
    const result = await parseFile(filePath);

    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].name).toBe("health_check");
    expect(result.functions[0].decorators.length).toBe(1);
    expect(result.functions[0].decorators[0]).toContain("app.route");
  });

  it("should extract decorated classes", async () => {
    const filePath = await writeTmpPython(
      "decorated_class.py",
      [
        "@dataclass",
        "class Config:",
        "    host: str",
        "    port: int",
        "",
      ].join("\n")
    );
    const result = await parseFile(filePath);

    expect(result.classes).toHaveLength(1);
    expect(result.classes[0].name).toBe("Config");
    expect(result.classes[0].decorators).toContain("dataclass");
  });

  it("should handle a complete module with imports, functions, and classes", async () => {
    const filePath = await writeTmpPython(
      "complete_module.py",
      [
        "import logging",
        "from typing import Optional",
        "",
        "logger = logging.getLogger(__name__)",
        "",
        "def create_service(name: str) -> 'Service':",
        '    """Factory function."""',
        "    return Service(name)",
        "",
        "class Service:",
        '    """A service class."""',
        "",
        "    def __init__(self, name: str):",
        "        self.name = name",
        "",
        "    async def start(self) -> None:",
        "        pass",
        "",
      ].join("\n")
    );
    const result = await parseFile(filePath);

    expect(result.imports).toHaveLength(2);
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].name).toBe("create_service");
    expect(result.functions[0].docstring).toBe("Factory function.");
    expect(result.classes).toHaveLength(1);
    expect(result.classes[0].name).toBe("Service");
    expect(result.classes[0].methods).toHaveLength(2);
  });

  it("should handle decorated methods inside classes", async () => {
    const filePath = await writeTmpPython(
      "decorated_methods.py",
      [
        "class MyClass:",
        "    @staticmethod",
        "    def static_method():",
        "        pass",
        "",
        "    @classmethod",
        "    def class_method(cls):",
        "        pass",
        "",
        "    @property",
        "    def value(self):",
        "        return self._value",
        "",
      ].join("\n")
    );
    const result = await parseFile(filePath);

    const cls = result.classes[0];
    expect(cls.methods).toHaveLength(3);
    expect(cls.methods[0].decorators).toContain("staticmethod");
    expect(cls.methods[1].decorators).toContain("classmethod");
    expect(cls.methods[2].decorators).toContain("property");
  });

  it("should be idempotent — parsing same file twice yields same result", async () => {
    const filePath = await writeTmpPython(
      "idempotent.py",
      "def hello() -> str:\n    return 'world'\n"
    );
    const r1 = await parseFile(filePath);
    const r2 = await parseFile(filePath);

    expect(r1).toEqual(r2);
  });

  it("should handle empty file", async () => {
    const filePath = await writeTmpPython("empty.py", "");
    const result = await parseFile(filePath);

    expect(result.file_path).toBe(filePath);
    expect(result.functions).toEqual([]);
    expect(result.classes).toEqual([]);
    expect(result.imports).toEqual([]);
  });

  it("should handle file with only comments", async () => {
    const filePath = await writeTmpPython(
      "comments_only.py",
      ["# This is a comment", "# Another comment", ""].join("\n")
    );
    const result = await parseFile(filePath);

    expect(result.functions).toEqual([]);
    expect(result.classes).toEqual([]);
  });

  it("should throw for non-existent file", async () => {
    await expect(
      parseFile("/tmp/parseFile-tests/does_not_exist_xyz.py")
    ).rejects.toThrow();
  });

  it("should handle multiple inheritance", async () => {
    const filePath = await writeTmpPython(
      "multi_inherit.py",
      [
        "class Mixin:",
        "    pass",
        "",
        "class Base:",
        "    pass",
        "",
        "class Combined(Base, Mixin):",
        "    def run(self):",
        "        pass",
        "",
      ].join("\n")
    );
    const result = await parseFile(filePath);

    const combined = result.classes.find((c) => c.name === "Combined");
    expect(combined).toBeDefined();
    expect(combined!.bases).toEqual(["Base", "Mixin"]);
  });

  it("should capture correct line numbers for classes", async () => {
    const filePath = await writeTmpPython(
      "class_lines.py",
      [
        "import os",
        "",
        "class First:",
        "    def method(self):",
        "        pass",
        "",
        "class Second:",
        "    pass",
        "",
      ].join("\n")
    );
    const result = await parseFile(filePath);

    expect(result.classes[0].name).toBe("First");
    expect(result.classes[0].start_line).toBe(3);
    expect(result.classes[1].name).toBe("Second");
    expect(result.classes[1].start_line).toBe(7);
  });

  it("should handle async functions at module level", async () => {
    const filePath = await writeTmpPython(
      "async_module.py",
      [
        "async def fetch(url: str) -> str:",
        "    pass",
        "",
        "async def process(data: bytes) -> None:",
        "    pass",
        "",
      ].join("\n")
    );
    const result = await parseFile(filePath);

    expect(result.functions).toHaveLength(2);
    expect(result.functions[0].is_async).toBe(true);
    expect(result.functions[1].is_async).toBe(true);
  });

  it("should not include nested functions as top-level", async () => {
    const filePath = await writeTmpPython(
      "nested.py",
      [
        "def outer():",
        "    def inner():",
        "        pass",
        "    return inner",
        "",
      ].join("\n")
    );
    const result = await parseFile(filePath);

    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].name).toBe("outer");
  });

  it("should handle aliased imports", async () => {
    const filePath = await writeTmpPython(
      "aliased.py",
      ["import numpy as np", "from collections import OrderedDict as OD", ""].join("\n")
    );
    const result = await parseFile(filePath);

    expect(result.imports).toHaveLength(2);
    expect(result.imports[0].is_from).toBe(false);
    expect(result.imports[1].is_from).toBe(true);
    expect(result.imports[1].module).toBe("collections");
  });
});
