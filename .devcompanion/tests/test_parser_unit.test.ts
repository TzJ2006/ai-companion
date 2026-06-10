import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { parseFile, initParser, parseSource } from "../../packages/ast/src/parser.js";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const TMP_DIR = resolve(tmpdir(), "parser-unit-tests");
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
});

describe("parser.ts - extractFunction", () => {
  it("should extract simple function", async () => {
    const source = "def add(a, b):\n    return a + b\n";
    const result = await parseFromSource(source);

    expect(result.functions).toHaveLength(1);
    const func = result.functions[0];
    expect(func.name).toBe("add");
    expect(func.params).toHaveLength(2);
  });

  it("should extract function with return type", async () => {
    const source = "def multiply(a: int, b: int) -> int:\n    return a * b\n";
    const result = await parseFromSource(source);

    const func = result.functions[0];
    expect(func.return_type).toBe("int");
  });

  it("should extract async function", async () => {
    const source = "async def fetch_data():\n    pass\n";
    const result = await parseFromSource(source);

    const func = result.functions[0];
    expect(func.is_async).toBe(true);
  });

  it("should extract docstring from function", async () => {
    const source = 'def documented():\n    """This is a docstring."""\n    pass\n';
    const result = await parseFromSource(source);

    const func = result.functions[0];
    expect(func.docstring).toBe("This is a docstring.");
  });

  it("should track function line numbers", async () => {
    const source = "x = 1\ndef foo():\n    return 42\n";
    const result = await parseFromSource(source);

    const func = result.functions[0];
    expect(func.start_line).toBe(2);
  });
});

describe("parser.ts - extractClass", () => {
  it("should extract simple class", async () => {
    const source = "class Point:\n    pass\n";
    const result = await parseFromSource(source);

    expect(result.classes).toHaveLength(1);
    const cls = result.classes[0];
    expect(cls.name).toBe("Point");
    expect(cls.bases).toEqual([]);
    expect(cls.methods).toHaveLength(0);
  });

  it("should extract class with single base", async () => {
    const source = "class Animal(Living):\n    pass\n";
    const result = await parseFromSource(source);

    const cls = result.classes[0];
    expect(cls.name).toBe("Animal");
    expect(cls.bases).toEqual(["Living"]);
  });

  it("should extract class with multiple bases", async () => {
    const source = "class Dog(Animal, Serializable, HasSound):\n    pass\n";
    const result = await parseFromSource(source);

    const cls = result.classes[0];
    expect(cls.bases).toHaveLength(3);
    expect(cls.bases).toContain("Animal");
    expect(cls.bases).toContain("Serializable");
    expect(cls.bases).toContain("HasSound");
  });

  it("should extract class methods", async () => {
    const source = "class Calculator:\n    def add(self, a, b):\n        return a + b\n    def subtract(self, a, b):\n        return a - b\n";
    const result = await parseFromSource(source);

    const cls = result.classes[0];
    expect(cls.methods).toHaveLength(2);
    expect(cls.methods[0].name).toBe("add");
    expect(cls.methods[1].name).toBe("subtract");
  });

  it("should track class line numbers", async () => {
    const source = "x = 1\nclass Foo:\n    def bar(self):\n        pass\n";
    const result = await parseFromSource(source);

    const cls = result.classes[0];
    expect(cls.start_line).toBe(2);
    expect(cls.end_line).toBeGreaterThanOrEqual(3);
  });

  it("should handle multiple classes in one file", async () => {
    const source = "class First:\n    pass\n\nclass Second(First):\n    def method(self):\n        pass\n";
    const result = await parseFromSource(source);

    expect(result.classes).toHaveLength(2);
    expect(result.classes[0].name).toBe("First");
    expect(result.classes[1].name).toBe("Second");
    expect(result.classes[1].bases).toEqual(["First"]);
  });
});

describe("parser.ts - extractDecorators", () => {
  it("should extract single decorator from function", async () => {
    const source = "@decorator\ndef func():\n    pass\n";
    const result = await parseFromSource(source);

    const func = result.functions[0];
    expect(func.decorators).toHaveLength(1);
    expect(func.decorators[0]).toBe("decorator");
  });

  it("should extract multiple decorators from function", async () => {
    const source = "@decorator1\n@decorator2\n@decorator3\ndef func():\n    pass\n";
    const result = await parseFromSource(source);

    const func = result.functions[0];
    expect(func.decorators).toHaveLength(3);
    expect(func.decorators).toContain("decorator1");
    expect(func.decorators).toContain("decorator2");
  });

  it("should extract staticmethod decorator", async () => {
    const source = "class MyClass:\n    @staticmethod\n    def static_method():\n        pass\n";
    const result = await parseFromSource(source);

    const method = result.classes[0].methods[0];
    expect(method.decorators).toContain("staticmethod");
  });

  it("should extract classmethod decorator", async () => {
    const source = "class MyClass:\n    @classmethod\n    def class_method(cls):\n        pass\n";
    const result = await parseFromSource(source);

    const method = result.classes[0].methods[0];
    expect(method.decorators).toContain("classmethod");
  });

  it("should extract decorator with arguments", async () => {
    const source = "@decorator(arg1, arg2)\ndef func():\n    pass\n";
    const result = await parseFromSource(source);

    const func = result.functions[0];
    expect(func.decorators).toHaveLength(1);
    expect(func.decorators[0]).toContain("decorator");
  });

  it("should extract decorated class", async () => {
    const source = "@dataclass\nclass Point:\n    x: int\n    y: int\n";
    const result = await parseFromSource(source);

    const cls = result.classes[0];
    expect(cls.decorators).toContain("dataclass");
  });
});

describe("parser.ts - extractFromImport", () => {
  it("should extract from-import with single name", async () => {
    const source = "from os import path\n";
    const result = await parseFromSource(source);

    expect(result.imports).toHaveLength(1);
    const imp = result.imports[0];
    expect(imp.module).toBe("os");
    expect(imp.names).toContain("path");
    expect(imp.is_from).toBe(true);
  });

  it("should extract from-import with multiple names", async () => {
    const source = "from collections import OrderedDict, defaultdict, Counter\n";
    const result = await parseFromSource(source);

    const imp = result.imports[0];
    expect(imp.module).toBe("collections");
    expect(imp.names).toContain("OrderedDict");
    expect(imp.names).toContain("defaultdict");
    expect(imp.names).toContain("Counter");
  });

  it("should extract from-import with dotted module", async () => {
    const source = "from os.path import join, dirname\n";
    const result = await parseFromSource(source);

    const imp = result.imports[0];
    expect(imp.module).toBe("os.path");
    expect(imp.names).toContain("join");
    expect(imp.names).toContain("dirname");
  });

  it("should set is_from to true for from-imports", async () => {
    const source = "from sys import argv\n";
    const result = await parseFromSource(source);

    const imp = result.imports[0];
    expect(imp.is_from).toBe(true);
  });

  it("should extract relative from-import", async () => {
    const source = "from . import utils\n";
    const result = await parseFromSource(source);

    const imp = result.imports[0];
    expect(imp.is_from).toBe(true);
    expect(imp.names).toContain("utils");
  });

  it("should distinguish from-import from regular import", async () => {
    const source = "import os\nfrom sys import argv\n";
    const result = await parseFromSource(source);

    const imports = result.imports;
    const regularImport = imports.find(i => i.module === "os");
    const fromImport = imports.find(i => i.module === "sys");

    expect(regularImport!.is_from).toBe(false);
    expect(fromImport!.is_from).toBe(true);
  });

  it("should handle multiple from-imports in one file", async () => {
    const source = "from os import path\nfrom sys import argv\nfrom typing import Dict, Optional\n";
    const result = await parseFromSource(source);

    const fromImports = result.imports.filter(i => i.is_from);
    expect(fromImports).toHaveLength(3);
  });
});

describe("parser.ts - Integration Tests", () => {
  it("should parse file with mixed content", async () => {
    const source = "import os\nfrom sys import argv\n\n@decorator\ndef standalone():\n    pass\n\nclass MyService:\n    def __init__(self):\n        pass\n\n    @staticmethod\n    def helper():\n        pass\n";
    const result = await parseFromSource(source);

    expect(result.functions).toHaveLength(1);
    expect(result.classes).toHaveLength(1);
    expect(result.imports).toHaveLength(2);
  });

  it("should preserve metadata in complex parsing", async () => {
    const source = 'from typing import Dict, Optional\n\nclass DataStore:\n    """A data storage service."""\n\n    def __init__(self, host: str, port: int = 5432):\n        """Initialize with connection details."""\n        pass\n\n    @property\n    def is_connected(self) -> bool:\n        return True\n';
    const result = await parseFromSource(source);

    const cls = result.classes[0];
    expect(cls.name).toBe("DataStore");
    expect(cls.methods).toHaveLength(2);

    const initMethod = cls.methods[0];
    expect(initMethod.name).toBe("__init__");
    expect(initMethod.docstring).toBe("Initialize with connection details.");

    const propMethod = cls.methods[1];
    expect(propMethod.decorators).toContain("property");
    expect(propMethod.return_type).toBe("bool");
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
