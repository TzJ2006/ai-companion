import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { parseFile, initParser, parseSource } from "../../packages/ast/src/parser.js";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const TMP_DIR = resolve(tmpdir(), "parser-comprehensive-tests");
let tmpCounter = 0;

function tmpPath(): string {
  return resolve(TMP_DIR, `test_${Date.now()}_${tmpCounter++}.py`);
}

async function parseFromSource(source: string) {
  const path = tmpPath();
  await writeFile(path, source, "utf-8");
  try {
    const result = await parseFile(path);
    return result;
  } finally {
    await unlink(path).catch(() => {});
  }
}

beforeAll(async () => {
  await mkdir(TMP_DIR, { recursive: true });
  await initParser();
});

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(TMP_DIR, { recursive: true, force: true }).catch(() => {});
});

describe("Parser - initParser", () => {
  it("should initialize parser successfully", async () => {
    await initParser();
    expect(true).toBe(true);
  });

  it("should be idempotent", async () => {
    await initParser();
    await initParser();
    expect(true).toBe(true);
  });
});

describe("Parser - parseSource", () => {
  it("should parse a simple Python function", () => {
    const source = "def hello():\n    pass\n";
    const tree = parseSource(source);

    expect(tree).toBeDefined();
    expect(tree.rootNode).toBeDefined();
    expect(tree.rootNode.childCount).toBeGreaterThan(0);
  });

  it("should parse a class definition", () => {
    const source = "class Foo:\n    pass\n";
    const tree = parseSource(source);

    expect(tree).toBeDefined();
    expect(tree.rootNode).toBeDefined();
  });

  it("should handle empty source", () => {
    const source = "";
    const tree = parseSource(source);

    expect(tree).toBeDefined();
    expect(tree.rootNode).toBeDefined();
  });
});

describe("Parser - parseFile - Classes", () => {
  it("should extract a simple class with no methods", async () => {
    const source = `class Empty:\n    pass\n`;
    const result = await parseFromSource(source);

    expect(result.classes).toHaveLength(1);
    expect(result.classes[0].name).toBe("Empty");
    expect(result.classes[0].methods).toHaveLength(0);
    expect(result.classes[0].bases).toHaveLength(0);
    expect(result.classes[0].decorators).toHaveLength(0);
  });

  it("should extract class with base classes", async () => {
    const source = `class Dog(Animal, Serializable):\n    pass\n`;
    const result = await parseFromSource(source);

    expect(result.classes).toHaveLength(1);
    expect(result.classes[0].name).toBe("Dog");
    expect(result.classes[0].bases).toEqual(["Animal", "Serializable"]);
  });

  it("should extract class methods", async () => {
    const source = [
      "class Calculator:",
      "    def add(self, a: int, b: int) -> int:",
      '        """Add two numbers."""',
      "        return a + b",
      "",
      "    def subtract(self, a: int, b: int) -> int:",
      "        return a - b",
      "",
    ].join("\n");
    const result = await parseFromSource(source);

    expect(result.classes).toHaveLength(1);
    const cls = result.classes[0];
    expect(cls.name).toBe("Calculator");
    expect(cls.methods).toHaveLength(2);

    const add = cls.methods[0];
    expect(add.name).toBe("add");
    expect(add.is_method).toBe(true);
    expect(add.class_name).toBe("Calculator");
    expect(add.return_type).toBe("int");
    expect(add.docstring).toBe("Add two numbers.");

    const subtract = cls.methods[1];
    expect(subtract.name).toBe("subtract");
    expect(subtract.is_method).toBe(true);
    expect(subtract.docstring).toBeNull();
  });

  it("should extract method parameters correctly", async () => {
    const source = [
      "class Service:",
      "    def process(self, data: str, count: int = 5, *args, **kwargs):",
      "        pass",
      "",
    ].join("\n");
    const result = await parseFromSource(source);

    const method = result.classes[0].methods[0];
    expect(method.params).toHaveLength(5);

    expect(method.params[0]).toMatchObject({ name: "self", type: null });
    expect(method.params[1]).toMatchObject({ name: "data", type: "str" });
    expect(method.params[2]).toMatchObject({ name: "count", type: "int", default_value: "5" });
    expect(method.params[3]).toMatchObject({ name: "args", is_args: true });
    expect(method.params[4]).toMatchObject({ name: "kwargs", is_kwargs: true });
  });

  it("should extract decorated methods", async () => {
    const source = [
      "class MyClass:",
      "    @staticmethod",
      "    def static_method():",
      "        pass",
      "",
      "    @classmethod",
      "    def class_method(cls):",
      "        pass",
      "",
    ].join("\n");
    const result = await parseFromSource(source);

    const cls = result.classes[0];
    expect(cls.methods).toHaveLength(2);

    expect(cls.methods[0].name).toBe("static_method");
    expect(cls.methods[0].decorators).toContain("staticmethod");

    expect(cls.methods[1].name).toBe("class_method");
    expect(cls.methods[1].decorators).toContain("classmethod");
  });

  it("should extract class with decorator", async () => {
    const source = [
      "@dataclass",
      "class Point:",
      "    x: int",
      "    y: int",
      "",
    ].join("\n");
    const result = await parseFromSource(source);

    expect(result.classes).toHaveLength(1);
    expect(result.classes[0].name).toBe("Point");
    expect(result.classes[0].decorators).toContain("dataclass");
  });

  it("should capture start and end lines", async () => {
    const source = [
      "class Foo:",
      "    def bar(self):",
      "        pass",
      "",
    ].join("\n");
    const result = await parseFromSource(source);

    const cls = result.classes[0];
    expect(cls.start_line).toBe(1);
    expect(cls.end_line).toBeGreaterThanOrEqual(3);
  });

  it("should handle multiple classes in one file", async () => {
    const source = [
      "class First:",
      "    pass",
      "",
      "class Second(First):",
      "    def method(self):",
      "        pass",
      "",
    ].join("\n");
    const result = await parseFromSource(source);

    expect(result.classes).toHaveLength(2);
    expect(result.classes[0].name).toBe("First");
    expect(result.classes[1].name).toBe("Second");
    expect(result.classes[1].bases).toEqual(["First"]);
    expect(result.classes[1].methods).toHaveLength(1);
  });

  it("should handle class with no body methods (only pass)", async () => {
    const source = `class Abstract(Base):\n    pass\n`;
    const result = await parseFromSource(source);

    expect(result.classes[0].methods).toHaveLength(0);
    expect(result.classes[0].name).toBe("Abstract");
  });

  it("should not include top-level functions in class methods", async () => {
    const source = [
      "def standalone():",
      "    pass",
      "",
      "class MyClass:",
      "    def method(self):",
      "        pass",
      "",
    ].join("\n");
    const result = await parseFromSource(source);

    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].name).toBe("standalone");
    expect(result.classes).toHaveLength(1);
    expect(result.classes[0].methods).toHaveLength(1);
    expect(result.classes[0].methods[0].name).toBe("method");
  });
});

describe("Parser - parseFile - Functions", () => {
  it("should extract a simple function", async () => {
    const source = "def greet(name: str) -> str:\n    return f'Hello {name}'\n";
    const result = await parseFromSource(source);

    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].name).toBe("greet");
    expect(result.functions[0].params).toHaveLength(1);
    expect(result.functions[0].params[0].name).toBe("name");
    expect(result.functions[0].params[0].type).toBe("str");
    expect(result.functions[0].return_type).toBe("str");
    expect(result.functions[0].is_method).toBe(false);
    expect(result.functions[0].is_async).toBe(false);
  });

  it("should extract async function", async () => {
    const source = "async def fetch():\n    pass\n";
    const result = await parseFromSource(source);

    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].name).toBe("fetch");
    expect(result.functions[0].is_async).toBe(true);
  });

  it("should extract function docstring", async () => {
    const source = 'def documented():\n    """This is a docstring"""\n    pass\n';
    const result = await parseFromSource(source);

    expect(result.functions[0].docstring).toBe("This is a docstring");
  });

  it("should extract function with default parameters", async () => {
    const source = "def config(host: str = 'localhost', port: int = 5432):\n    pass\n";
    const result = await parseFromSource(source);

    const params = result.functions[0].params;
    expect(params[0].name).toBe("host");
    expect(params[0].default_value).toBe("'localhost'");
    expect(params[1].name).toBe("port");
    expect(params[1].default_value).toBe("5432");
  });

  it("should extract *args and **kwargs", async () => {
    const source = "def flexible(*args, **kwargs):\n    pass\n";
    const result = await parseFromSource(source);

    const params = result.functions[0].params;
    const args = params.find(p => p.is_args);
    const kwargs = params.find(p => p.is_kwargs);

    expect(args).toBeDefined();
    expect(args!.name).toBe("args");
    expect(kwargs).toBeDefined();
    expect(kwargs!.name).toBe("kwargs");
  });

  it("should extract decorated function", async () => {
    const source = "@cache\ndef fibonacci(n):\n    pass\n";
    const result = await parseFromSource(source);

    expect(result.functions[0].decorators).toContain("cache");
  });

  it("should preserve function order", async () => {
    const source = "def alpha():\n    pass\n\ndef beta():\n    pass\n\ndef gamma():\n    pass\n";
    const result = await parseFromSource(source);

    const names = result.functions.map(f => f.name);
    expect(names).toEqual(["alpha", "beta", "gamma"]);
  });

  it("should extract function with no parameters", async () => {
    const source = "def noop():\n    pass\n";
    const result = await parseFromSource(source);

    expect(result.functions[0].params).toHaveLength(0);
  });

  it("should extract line numbers for functions", async () => {
    const source = "def first():\n    pass\n\ndef second():\n    pass\n";
    const result = await parseFromSource(source);

    expect(result.functions[0].start_line).toBe(1);
    expect(result.functions[0].end_line).toBeGreaterThanOrEqual(2);
    expect(result.functions[1].start_line).toBeGreaterThan(result.functions[0].end_line);
  });
});

describe("Parser - parseFile - Imports", () => {
  it("should extract simple import", async () => {
    const source = "import os\n";
    const result = await parseFromSource(source);

    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].module).toBe("os");
    expect(result.imports[0].is_from).toBe(false);
    expect(result.imports[0].line).toBeGreaterThan(0);
  });

  it("should extract from import", async () => {
    const source = "from os import path\n";
    const result = await parseFromSource(source);

    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].module).toBe("os");
    expect(result.imports[0].is_from).toBe(true);
    expect(result.imports[0].names).toContain("path");
  });

  it("should extract multiple imports from same module", async () => {
    const source = "from os import path, environ, getcwd\n";
    const result = await parseFromSource(source);

    expect(result.imports).toHaveLength(1);
    const imp = result.imports[0];
    expect(imp.module).toBe("os");
    expect(imp.names.length).toBeGreaterThanOrEqual(3);
  });

  it("should extract dotted imports", async () => {
    const source = "import os.path\n";
    const result = await parseFromSource(source);

    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].module).toBeDefined();
  });

  it("should extract line numbers for imports", async () => {
    const source = "import os\n\nimport sys\n";
    const result = await parseFromSource(source);

    expect(result.imports.length).toBeGreaterThanOrEqual(2);
    expect(result.imports[0].line).toBe(1);
    expect(result.imports[1].line).toBeGreaterThan(result.imports[0].line);
  });
});

describe("Parser - parseFile - Complex Scenarios", () => {
  it("should parse complex file with all constructs", async () => {
    const source = `import os
from typing import Optional

@decorator
async def process(data: list[str], timeout: int = 30) -> dict:
    """Process data asynchronously."""
    return {}

class DataHandler:
    def __init__(self):
        pass

    @staticmethod
    def validate(value):
        pass
`;
    const result = await parseFromSource(source);

    expect(result.functions.length).toBeGreaterThanOrEqual(1);
    expect(result.classes.length).toBeGreaterThanOrEqual(1);
    expect(result.imports.length).toBeGreaterThanOrEqual(2);
  });

  it("should handle file with only comments", async () => {
    const source = "# This is a comment\n# Another comment\n";
    const result = await parseFromSource(source);

    expect(result.functions).toHaveLength(0);
    expect(result.classes).toHaveLength(0);
  });

  it("should handle file with variables only", async () => {
    const source = "x = 1\ny = 'hello'\nz = [1, 2, 3]\n";
    const result = await parseFromSource(source);

    expect(result.functions).toHaveLength(0);
    expect(result.classes).toHaveLength(0);
  });

  it("should return valid ParsedModule structure", async () => {
    const source = "def func(): pass\nclass Cls: pass\nimport os\n";
    const result = await parseFromSource(source);

    expect(result).toHaveProperty("file_path");
    expect(result).toHaveProperty("functions");
    expect(result).toHaveProperty("classes");
    expect(result).toHaveProperty("imports");

    expect(Array.isArray(result.functions)).toBe(true);
    expect(Array.isArray(result.classes)).toBe(true);
    expect(Array.isArray(result.imports)).toBe(true);
  });

  it("should validate FunctionSignature structure", async () => {
    const source = "def test(): pass\n";
    const result = await parseFromSource(source);

    const func = result.functions[0];
    expect(func).toHaveProperty("name");
    expect(func).toHaveProperty("params");
    expect(func).toHaveProperty("return_type");
    expect(func).toHaveProperty("decorators");
    expect(func).toHaveProperty("is_method");
    expect(func).toHaveProperty("is_async");
    expect(func).toHaveProperty("class_name");
    expect(func).toHaveProperty("start_line");
    expect(func).toHaveProperty("end_line");
    expect(func).toHaveProperty("docstring");
  });

  it("should validate ClassInfo structure", async () => {
    const source = "class Cls: pass\n";
    const result = await parseFromSource(source);

    const cls = result.classes[0];
    expect(cls).toHaveProperty("name");
    expect(cls).toHaveProperty("methods");
    expect(cls).toHaveProperty("decorators");
    expect(cls).toHaveProperty("start_line");
    expect(cls).toHaveProperty("end_line");
    expect(cls).toHaveProperty("bases");
  });

  it("should validate ImportInfo structure", async () => {
    const source = "import os\n";
    const result = await parseFromSource(source);

    const imp = result.imports[0];
    expect(imp).toHaveProperty("module");
    expect(imp).toHaveProperty("names");
    expect(imp).toHaveProperty("is_from");
    expect(imp).toHaveProperty("line");
  });

  it("should validate FunctionParam structure", async () => {
    const source = "def f(x: int = 5): pass\n";
    const result = await parseFromSource(source);

    const param = result.functions[0].params[0];
    expect(param).toHaveProperty("name");
    expect(param).toHaveProperty("type");
    expect(param).toHaveProperty("default_value");
    expect(param).toHaveProperty("is_args");
    expect(param).toHaveProperty("is_kwargs");
  });

  it("should handle multiline docstring", async () => {
    const source = `def func():
    """
    Line 1
    Line 2
    """
    pass
`;
    const result = await parseFromSource(source);

    expect(result.functions[0].docstring).toBeDefined();
    expect(result.functions[0].docstring).toContain("Line 1");
  });

  it("should extract properties as methods", async () => {
    const source = `class Config:
    @property
    def value(self):
        return self._value

    @value.setter
    def value(self, val):
        self._value = val
`;
    const result = await parseFromSource(source);

    const cls = result.classes[0];
    expect(cls.methods.length).toBeGreaterThanOrEqual(1);
  });

  it("should handle nested functions", async () => {
    const source = `def outer():
    def inner():
        pass
    return inner
`;
    const result = await parseFromSource(source);

    expect(result.functions[0].name).toBe("outer");
  });

  it("should extract function with complex type annotations", async () => {
    const source = `from typing import Callable, Union

def handler(
    callback: Callable[[str, int], bool],
    data: Union[dict, list, str]
) -> dict:
    pass
`;
    const result = await parseFromSource(source);

    const func = result.functions[0];
    expect(func.name).toBe("handler");
    expect(func.params.length).toBeGreaterThanOrEqual(2);
  });

  it("should extract __name__ guard correctly", async () => {
    const source = `def main():
    pass

if __name__ == '__main__':
    main()
`;
    const result = await parseFromSource(source);

    expect(result.functions[0].name).toBe("main");
  });
});
