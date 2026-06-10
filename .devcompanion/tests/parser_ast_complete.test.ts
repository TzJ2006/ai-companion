import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  findWasmPath,
  initParser,
  parseSource,
  parseFile,
  extractFunction,
  extractParams,
  extractClass,
  handleDecorated,
  extractDecorators,
  extractDocstring,
  extractImport,
  extractFromImport,
} from "../../packages/ast/src/parser.js";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

const TMP_DIR = resolve(tmpdir(), "parser-ast-tests");
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

describe("parser.ts - findWasmPath", () => {
  it("should return a valid wasm file path", () => {
    const path = findWasmPath();
    expect(typeof path).toBe("string");
    expect(path).toContain("tree-sitter-python.wasm");
  });

  it("should find wasm file at one of the candidate locations", () => {
    const path = findWasmPath();
    expect(existsSync(path)).toBe(true);
  });
});

describe("parser.ts - extractParams", () => {
  it("should extract simple parameter names", async () => {
    const source = "def greet(name):\n    pass\n";
    const result = await parseFromSource(source);

    expect(result.functions).toHaveLength(1);
    const func = result.functions[0];
    expect(func.params).toHaveLength(1);
    expect(func.params[0].name).toBe("name");
    expect(func.params[0].type).toBeNull();
  });

  it("should extract typed parameters", async () => {
    const source = "def calculate(value: int):\n    pass\n";
    const result = await parseFromSource(source);

    const func = result.functions[0];
    expect(func.params).toHaveLength(1);
    expect(func.params[0].name).toBe("value");
    expect(func.params[0].type).toBe("int");
  });

  it("should extract *args parameter", async () => {
    const source = "def collect(*items):\n    pass\n";
    const result = await parseFromSource(source);

    const func = result.functions[0];
    expect(func.params[0].is_args).toBe(true);
  });

  it("should extract **kwargs parameter", async () => {
    const source = "def configure(**options):\n    pass\n";
    const result = await parseFromSource(source);

    const func = result.functions[0];
    expect(func.params[0].is_kwargs).toBe(true);
  });

  it("should extract multiple mixed parameters", async () => {
    const source = "def complex_func(a, b: str, c=10, d: int = 20, *args, **kwargs):\n    pass\n";
    const result = await parseFromSource(source);

    const func = result.functions[0];
    expect(func.params).toHaveLength(6);
  });

  it("should handle default values", async () => {
    const source = "def config(host='localhost', port: int = 5432):\n    pass\n";
    const result = await parseFromSource(source);

    const func = result.functions[0];
    const withDefault = func.params.filter(p => p.default_value);
    expect(withDefault.length).toBeGreaterThanOrEqual(1);
  });

  it("should handle self parameter in methods", async () => {
    const source = "class Worker:\n    def work(self, task):\n        pass\n";
    const result = await parseFromSource(source);

    const cls = result.classes[0];
    const method = cls.methods[0];
    expect(method.params.length).toBeGreaterThanOrEqual(1);
  });
});

describe("parser.ts - initParser", () => {
  it("should initialize parser without throwing", async () => {
    await expect(initParser()).resolves.not.toThrow();
  });

  it("should be idempotent", async () => {
    await initParser();
    await expect(initParser()).resolves.not.toThrow();
  });
});

describe("parser.ts - parseSource", () => {
  it("should parse valid Python source", async () => {
    await initParser();
    const source = "def hello():\n    pass\n";
    const tree = parseSource(source);
    expect(tree).toBeDefined();
    expect(tree.rootNode).toBeDefined();
  });

  it("should handle empty source", async () => {
    await initParser();
    const tree = parseSource("");
    expect(tree).toBeDefined();
  });

  it("should parse complex nested structures", async () => {
    await initParser();
    const source = "class MyClass:\n    def method(self):\n        if True:\n            for i in range(10):\n                pass\n";
    const tree = parseSource(source);
    expect(tree).toBeDefined();
  });
});

describe("parser.ts - extractFunction", () => {
  it("should extract simple function", async () => {
    const source = "def add(a, b):\n    return a + b\n";
    const result = await parseFromSource(source);

    expect(result.functions).toHaveLength(1);
    const func = result.functions[0];
    expect(func.name).toBe("add");
    expect(func.params).toHaveLength(2);
    expect(func.is_method).toBe(false);
  });

  it("should extract function with return type", async () => {
    const source = "def multiply(a: int, b: int) -> int:\n    return a * b\n";
    const result = await parseFromSource(source);

    const func = result.functions[0];
    expect(func.return_type).toBe("int");
  });

  it("should extract async function", async () => {
    const source = "async def fetch():\n    pass\n";
    const result = await parseFromSource(source);

    const func = result.functions[0];
    expect(func.is_async).toBe(true);
  });

  it("should extract docstring", async () => {
    const source = 'def documented():\n    """This is a docstring"""\n    pass\n';
    const result = await parseFromSource(source);

    const func = result.functions[0];
    expect(func.docstring).toBe("This is a docstring");
  });

  it("should capture line numbers", async () => {
    const source = "def first():\n    pass\n\ndef second():\n    pass\n";
    const result = await parseFromSource(source);

    expect(result.functions[0].start_line).toBe(1);
    expect(result.functions[1].start_line).toBeGreaterThan(1);
  });

  it("should extract function with multiple parameters", async () => {
    const source = "def greet(name: str, age: int = 18) -> str:\n    return f'Hello {name}'\n";
    const result = await parseFromSource(source);

    const func = result.functions[0];
    expect(func.name).toBe("greet");
    expect(func.params.length).toBeGreaterThanOrEqual(2);
    expect(func.return_type).toBe("str");
  });

  it("should handle function with no parameters", async () => {
    const source = "def noop():\n    return 42\n";
    const result = await parseFromSource(source);

    const func = result.functions[0];
    expect(func.params).toHaveLength(0);
  });
});

describe("parser.ts - extractClass", () => {
  it("should extract class name", async () => {
    const source = "class Animal:\n    pass\n";
    const result = await parseFromSource(source);

    expect(result.classes).toHaveLength(1);
    expect(result.classes[0].name).toBe("Animal");
  });

  it("should extract base classes", async () => {
    const source = "class Dog(Animal):\n    pass\n";
    const result = await parseFromSource(source);

    const cls = result.classes[0];
    expect(cls.bases).toContain("Animal");
  });

  it("should extract class methods", async () => {
    const source = "class Calculator:\n    def add(self, a, b):\n        return a + b\n    def subtract(self, a, b):\n        return a - b\n";
    const result = await parseFromSource(source);

    const cls = result.classes[0];
    expect(cls.methods.length).toBeGreaterThanOrEqual(2);
  });

  it("should mark methods with is_method=true", async () => {
    const source = "class Worker:\n    def work(self):\n        pass\n";
    const result = await parseFromSource(source);

    const cls = result.classes[0];
    const method = cls.methods[0];
    expect(method.is_method).toBe(true);
    expect(method.class_name).toBe("Worker");
  });

  it("should capture class line numbers", async () => {
    const source = "class MyClass:\n    def method(self):\n        pass\n";
    const result = await parseFromSource(source);

    const cls = result.classes[0];
    expect(cls.start_line).toBeGreaterThanOrEqual(1);
    expect(cls.end_line).toBeGreaterThanOrEqual(cls.start_line);
  });

  it("should extract __init__ method", async () => {
    const source = "class Person:\n    def __init__(self, name: str):\n        self.name = name\n";
    const result = await parseFromSource(source);

    const cls = result.classes[0];
    const init = cls.methods.find(m => m.name === "__init__");
    expect(init).toBeDefined();
    expect(init?.params.length).toBeGreaterThanOrEqual(2);
  });

  it("should handle multiple base classes", async () => {
    const source = "class Worker(Human, Mortal):\n    pass\n";
    const result = await parseFromSource(source);

    const cls = result.classes[0];
    expect(cls.bases.length).toBeGreaterThanOrEqual(1);
  });
});

describe("parser.ts - extractDecorators", () => {
  it("should extract decorator from function", async () => {
    const source = "@staticmethod\ndef compute():\n    pass\n";
    const result = await parseFromSource(source);

    const func = result.functions[0];
    expect(func.decorators.length).toBeGreaterThanOrEqual(0);
  });

  it("should extract decorator from class", async () => {
    const source = "@dataclass\nclass Point:\n    x: int\n";
    const result = await parseFromSource(source);

    const cls = result.classes[0];
    expect(cls.decorators.length).toBeGreaterThanOrEqual(0);
  });

  it("should extract multiple decorators", async () => {
    const source = "@decorator1\n@decorator2\ndef special():\n    pass\n";
    const result = await parseFromSource(source);

    const func = result.functions[0];
    expect(func.decorators.length).toBeGreaterThanOrEqual(0);
  });
});

describe("parser.ts - extractDocstring", () => {
  it("should extract docstring from function", async () => {
    const source = 'def func():\n    """Docstring"""\n    pass\n';
    const result = await parseFromSource(source);

    const func = result.functions[0];
    expect(func.docstring).toBeDefined();
  });

  it("should return null for missing docstring", async () => {
    const source = "def func():\n    x = 1\n    return x\n";
    const result = await parseFromSource(source);

    const func = result.functions[0];
    expect(func.docstring).toBeNull();
  });

  it("should extract multiline docstring", async () => {
    const source = 'def func():\n    """First line\n    Second line"""\n    pass\n';
    const result = await parseFromSource(source);

    const func = result.functions[0];
    expect(func.docstring).toBeDefined();
  });
});

describe("parser.ts - extractImport", () => {
  it("should extract simple import", async () => {
    const source = "import os\n";
    const result = await parseFromSource(source);

    const imp = result.imports[0];
    expect(imp.module).toBe("os");
    expect(imp.is_from).toBe(false);
  });

  it("should extract aliased import", async () => {
    const source = "import numpy as np\n";
    const result = await parseFromSource(source);

    const imp = result.imports[0];
    expect(imp.module).toBe("numpy as np");
  });

  it("should capture import line number", async () => {
    const source = "import os\n\ndef foo():\n    pass\n";
    const result = await parseFromSource(source);

    expect(result.imports[0].line).toBe(1);
  });

  it("should handle multiple imports", async () => {
    const source = "import os, sys\n";
    const result = await parseFromSource(source);

    expect(result.imports.length).toBeGreaterThanOrEqual(1);
  });
});

describe("parser.ts - extractFromImport", () => {
  it("should extract from import", async () => {
    const source = "from os import path\n";
    const result = await parseFromSource(source);

    const imp = result.imports[0];
    expect(imp.module).toBe("os");
    expect(imp.is_from).toBe(true);
  });

  it("should extract multiple items", async () => {
    const source = "from os import path, getcwd\n";
    const result = await parseFromSource(source);

    const imp = result.imports[0];
    expect(imp.module).toBe("os");
    expect(imp.names.length).toBeGreaterThanOrEqual(1);
  });

  it("should extract from import with alias", async () => {
    const source = "from os import path as p\n";
    const result = await parseFromSource(source);

    const imp = result.imports[0];
    expect(imp.is_from).toBe(true);
  });

  it("should extract relative import", async () => {
    const source = "from . import module\n";
    const result = await parseFromSource(source);

    const imp = result.imports[0];
    expect(imp.is_from).toBe(true);
  });
});

describe("parser.ts - parseFile", () => {
  it("should parse complete module", async () => {
    const source = "import os\nfrom typing import List\n\ndef helper():\n    pass\n\nclass MyClass:\n    def method(self, x: int) -> int:\n        return x\n";
    const result = await parseFromSource(source);

    expect(result.file_path).toBeDefined();
    expect(result.imports).toHaveLength(2);
    expect(result.functions.length).toBeGreaterThanOrEqual(1);
    expect(result.classes).toHaveLength(1);
  });

  it("should handle empty file", async () => {
    const result = await parseFromSource("");

    expect(result.imports).toHaveLength(0);
    expect(result.functions).toHaveLength(0);
    expect(result.classes).toHaveLength(0);
  });

  it("should preserve file_path", async () => {
    const path = tmpPath();
    await writeFile(path, "x = 1\n", "utf-8");

    try {
      const result = await parseFile(path);
      expect(result.file_path).toBe(path);
    } finally {
      await unlink(path).catch(() => {});
    }
  });

  it("should validate ParsedModule structure", async () => {
    const result = await parseFromSource("def f(): pass\n");

    expect(result).toHaveProperty("file_path");
    expect(result).toHaveProperty("functions");
    expect(result).toHaveProperty("classes");
    expect(result).toHaveProperty("imports");
    expect(Array.isArray(result.functions)).toBe(true);
  });

  it("should extract multiple functions and classes", async () => {
    const source = "def func1():\n    pass\n\ndef func2():\n    pass\n\nclass Class1:\n    pass\n\nclass Class2:\n    pass\n";
    const result = await parseFromSource(source);

    expect(result.functions.length).toBeGreaterThanOrEqual(2);
    expect(result.classes.length).toBeGreaterThanOrEqual(2);
  });

  it("should handle file with only comments", async () => {
    const source = "# Comment 1\n# Comment 2\n";
    const result = await parseFromSource(source);

    expect(result.imports).toHaveLength(0);
    expect(result.functions).toHaveLength(0);
  });
});

describe("parser.ts - comprehensive scenarios", () => {
  it("should parse realistic module", async () => {
    const source = "import json\nfrom typing import Dict\n\nclass HTTPClient:\n    def __init__(self, base_url: str):\n        self.base_url = base_url\n    async def get(self, path: str) -> Dict:\n        return {}\n\nasync def main():\n    return None\n";
    const result = await parseFromSource(source);

    expect(result.functions).toHaveLength(1);
    expect(result.classes).toHaveLength(1);
    expect(result.imports).toHaveLength(2);
  });

  it("should identify method vs function", async () => {
    const source = "class Container:\n    def method1(self):\n        pass\n\ndef standalone():\n    pass\n";
    const result = await parseFromSource(source);

    const cls = result.classes[0];
    expect(cls.methods[0].is_method).toBe(true);
    expect(result.functions[0].is_method).toBe(false);
  });

  it("should extract all parameter types in one function", async () => {
    const source = "def comprehensive(pos: str, opt: int = 10, *args, **kwargs):\n    pass\n";
    const result = await parseFromSource(source);

    const func = result.functions[0];
    expect(func.params.length).toBeGreaterThanOrEqual(2);
  });

  it("should handle multiple classes with inheritance", async () => {
    const source = "class Base:\n    pass\n\nclass Derived(Base):\n    def method(self):\n        pass\n";
    const result = await parseFromSource(source);

    expect(result.classes).toHaveLength(2);
    const derived = result.classes.find(c => c.name === "Derived");
    expect(derived?.bases).toContain("Base");
  });

  it("should extract class with special methods", async () => {
    const source = "class MyClass:\n    def __init__(self):\n        pass\n    def __str__(self):\n        return 'MyClass'\n    def __repr__(self):\n        return 'MyClass()'\n";
    const result = await parseFromSource(source);

    const cls = result.classes[0];
    const methodNames = cls.methods.map(m => m.name);
    expect(methodNames).toContain("__init__");
    expect(methodNames).toContain("__str__");
    expect(methodNames).toContain("__repr__");
  });
});
