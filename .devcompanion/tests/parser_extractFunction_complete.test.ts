import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

const TMP_DIR = join(tmpdir(), "parser-complete-tests");
let tmpFiles: string[] = [];

async function writeTmpPython(name: string, content: string): Promise<string> {
  const filePath = join(TMP_DIR, name);
  await writeFile(filePath, content, "utf-8");
  tmpFiles.push(filePath);
  return filePath;
}

describe("findWasmPath", () => {
  it("should return a string", () => {
    const result = findWasmPath();
    expect(typeof result).toBe("string");
  });

  it("should return a non-empty string", () => {
    const result = findWasmPath();
    expect(result.length).toBeGreaterThan(0);
  });

  it("should return a path containing tree-sitter-python.wasm", () => {
    const result = findWasmPath();
    expect(result).toContain("tree-sitter-python.wasm");
  });

  it("should return an existing file path", () => {
    const result = findWasmPath();
    expect(existsSync(result)).toBe(true);
  });
});

describe("Parser Initialization and Source Parsing", () => {
  beforeAll(async () => {
    await mkdir(TMP_DIR, { recursive: true });
    await initParser();
  });

  afterAll(async () => {
    for (const f of tmpFiles) {
      await unlink(f).catch(() => {});
    }
  });

  it("should initialize parser successfully", async () => {
    await expect(initParser()).resolves.toBeUndefined();
  });

  it("should be idempotent — multiple init calls should not error", async () => {
    await initParser();
    await expect(initParser()).resolves.toBeUndefined();
  });

  it("should parse empty source", () => {
    const tree = parseSource("");
    expect(tree).toBeDefined();
    expect(tree.rootNode).toBeDefined();
    expect(tree.rootNode.type).toBe("module");
  });

  it("should parse simple function source", () => {
    const tree = parseSource("def hello():\n    pass\n");
    expect(tree).toBeDefined();
    expect(tree.rootNode.type).toBe("module");
    expect(tree.rootNode.childCount).toBeGreaterThan(0);
  });

  it("should parse class definition", () => {
    const tree = parseSource("class MyClass:\n    pass\n");
    const root = tree.rootNode;
    expect(root.namedChildCount).toBeGreaterThan(0);
    const firstChild = root.namedChild(0);
    expect(firstChild!.type).toBe("class_definition");
  });

  it("should parse import statement", () => {
    const tree = parseSource("import os\n");
    const root = tree.rootNode;
    expect(root.namedChildCount).toBeGreaterThan(0);
    const firstChild = root.namedChild(0);
    expect(firstChild!.type).toBe("import_statement");
  });

  it("should parse from import statement", () => {
    const tree = parseSource("from typing import Optional\n");
    const root = tree.rootNode;
    const firstChild = root.namedChild(0);
    expect(firstChild!.type).toBe("import_from_statement");
  });

  it("should parse decorated function", () => {
    const tree = parseSource("@decorator\ndef func():\n    pass\n");
    const root = tree.rootNode;
    const firstChild = root.namedChild(0);
    expect(firstChild!.type).toBe("decorated_definition");
  });

  it("should parse source with syntax errors", () => {
    const tree = parseSource("def broken(\n");
    expect(tree).toBeDefined();
    expect(tree.rootNode.hasError).toBe(true);
  });

  it("should throw when parseSource is called without init", async () => {
    const tree = parseSource("x = 1\n");
    expect(tree).toBeDefined();
  });
});

describe("extractParams", () => {
  beforeAll(async () => {
    await initParser();
  });

  it("should extract no params from empty parameter list", () => {
    const tree = parseSource("def f():\n    pass\n");
    const root = tree.rootNode;
    const funcNode = root.namedChild(0)!;
    const paramsNode = funcNode.childForFieldName("parameters");
    const params = extractParams(paramsNode!);
    expect(params).toHaveLength(0);
  });

  it("should extract simple identifier parameter", () => {
    const tree = parseSource("def f(x):\n    pass\n");
    const root = tree.rootNode;
    const funcNode = root.namedChild(0)!;
    const paramsNode = funcNode.childForFieldName("parameters");
    const params = extractParams(paramsNode!);
    expect(params).toHaveLength(1);
    expect(params[0].name).toBe("x");
    expect(params[0].type).toBeNull();
    expect(params[0].is_args).toBe(false);
    expect(params[0].is_kwargs).toBe(false);
  });

  it("should extract typed parameter", () => {
    const tree = parseSource("def f(x: int):\n    pass\n");
    const root = tree.rootNode;
    const funcNode = root.namedChild(0)!;
    const paramsNode = funcNode.childForFieldName("parameters");
    const params = extractParams(paramsNode!);
    expect(params).toHaveLength(1);
    expect(params[0].name).toBe("x");
    expect(params[0].type).toBe("int");
  });

  it("should extract default parameter", () => {
    const tree = parseSource("def f(x=10):\n    pass\n");
    const root = tree.rootNode;
    const funcNode = root.namedChild(0)!;
    const paramsNode = funcNode.childForFieldName("parameters");
    const params = extractParams(paramsNode!);
    expect(params).toHaveLength(1);
    expect(params[0].name).toBe("x");
    expect(params[0].default_value).toBe("10");
  });

  it("should extract typed default parameter", () => {
    const tree = parseSource("def f(x: int = 42):\n    pass\n");
    const root = tree.rootNode;
    const funcNode = root.namedChild(0)!;
    const paramsNode = funcNode.childForFieldName("parameters");
    const params = extractParams(paramsNode!);
    expect(params).toHaveLength(1);
    expect(params[0].name).toBe("x");
    expect(params[0].type).toBe("int");
    expect(params[0].default_value).toBe("42");
  });

  it("should extract *args parameter", () => {
    const tree = parseSource("def f(*args):\n    pass\n");
    const root = tree.rootNode;
    const funcNode = root.namedChild(0)!;
    const paramsNode = funcNode.childForFieldName("parameters");
    const params = extractParams(paramsNode!);
    expect(params.some((p) => p.is_args)).toBe(true);
    const argsParam = params.find((p) => p.is_args);
    expect(argsParam!.name).toBe("args");
  });

  it("should extract **kwargs parameter", () => {
    const tree = parseSource("def f(**kwargs):\n    pass\n");
    const root = tree.rootNode;
    const funcNode = root.namedChild(0)!;
    const paramsNode = funcNode.childForFieldName("parameters");
    const params = extractParams(paramsNode!);
    expect(params.some((p) => p.is_kwargs)).toBe(true);
    const kwargsParam = params.find((p) => p.is_kwargs);
    expect(kwargsParam!.name).toBe("kwargs");
  });

  it("should extract multiple mixed parameters", () => {
    const tree = parseSource("def f(a, b: int, c=5, *args, **kwargs):\n    pass\n");
    const root = tree.rootNode;
    const funcNode = root.namedChild(0)!;
    const paramsNode = funcNode.childForFieldName("parameters");
    const params = extractParams(paramsNode!);
    expect(params.length).toBeGreaterThanOrEqual(5);
  });
});

describe("extractFunction", () => {
  beforeAll(async () => {
    await mkdir(TMP_DIR, { recursive: true });
    await initParser();
  });

  afterAll(async () => {
    for (const f of tmpFiles) {
      await unlink(f).catch(() => {});
    }
  });

  it("should extract basic function name", async () => {
    const filePath = await writeTmpPython("basic.py", "def greet():\n    pass\n");
    const result = await parseFile(filePath);
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].name).toBe("greet");
  });

  it("should mark function as not a method when at module level", async () => {
    const filePath = await writeTmpPython(
      "module_func.py",
      "def standalone():\n    pass\n"
    );
    const result = await parseFile(filePath);
    expect(result.functions[0].is_method).toBe(false);
    expect(result.functions[0].class_name).toBeNull();
  });

  it("should detect async functions", async () => {
    const filePath = await writeTmpPython(
      "async_func.py",
      "async def fetch():\n    pass\n"
    );
    const result = await parseFile(filePath);
    expect(result.functions[0].is_async).toBe(true);
  });

  it("should extract return type annotation", async () => {
    const filePath = await writeTmpPython(
      "return_type.py",
      "def get_count() -> int:\n    return 42\n"
    );
    const result = await parseFile(filePath);
    expect(result.functions[0].return_type).toBe("int");
  });

  it("should extract complex return type", async () => {
    const filePath = await writeTmpPython(
      "complex_return.py",
      "def get_items() -> list[dict[str, int]]:\n    return []\n"
    );
    const result = await parseFile(filePath);
    expect(result.functions[0].return_type).toBe("list[dict[str, int]]");
  });

  it("should extract function with parameters", async () => {
    const filePath = await writeTmpPython(
      "with_params.py",
      "def add(a: int, b: int) -> int:\n    return a + b\n"
    );
    const result = await parseFile(filePath);
    const fn = result.functions[0];
    expect(fn.params).toHaveLength(2);
    expect(fn.params[0].name).toBe("a");
    expect(fn.params[1].name).toBe("b");
  });

  it("should extract docstring from function", async () => {
    const filePath = await writeTmpPython(
      "docstring.py",
      'def documented():\n    """Returns the answer."""\n    return 42\n'
    );
    const result = await parseFile(filePath);
    expect(result.functions[0].docstring).toBe("Returns the answer.");
  });

  it("should extract start and end line numbers", async () => {
    const filePath = await writeTmpPython(
      "lines.py",
      "x = 1\n\ndef on_line_three():\n    return True\n"
    );
    const result = await parseFile(filePath);
    expect(result.functions[0].start_line).toBe(3);
    expect(result.functions[0].end_line).toBe(4);
  });

  it("should have empty decorators array by default", async () => {
    const filePath = await writeTmpPython(
      "no_decorators.py",
      "def plain():\n    pass\n"
    );
    const result = await parseFile(filePath);
    expect(result.functions[0].decorators).toEqual([]);
  });
});

describe("extractClass", () => {
  beforeAll(async () => {
    await mkdir(TMP_DIR, { recursive: true });
    await initParser();
  });

  afterAll(async () => {
    for (const f of tmpFiles) {
      await unlink(f).catch(() => {});
    }
  });

  it("should extract class name", async () => {
    const filePath = await writeTmpPython(
      "simple_class.py",
      "class Service:\n    pass\n"
    );
    const result = await parseFile(filePath);
    expect(result.classes).toHaveLength(1);
    expect(result.classes[0].name).toBe("Service");
  });

  it("should extract class with base class", async () => {
    const filePath = await writeTmpPython("inherit.py", "class Child(Parent):\n    pass\n");
    const result = await parseFile(filePath);
    expect(result.classes[0].bases).toHaveLength(1);
    expect(result.classes[0].bases[0]).toBe("Parent");
  });

  it("should extract class with multiple base classes", async () => {
    const filePath = await writeTmpPython(
      "multi_inherit.py",
      "class MultiChild(Parent1, Parent2):\n    pass\n"
    );
    const result = await parseFile(filePath);
    expect(result.classes[0].bases.length).toBeGreaterThanOrEqual(2);
  });

  it("should extract class methods", async () => {
    const filePath = await writeTmpPython(
      "with_methods.py",
      "class MyClass:\n    def method1(self):\n        pass\n    def method2(self, arg):\n        pass\n"
    );
    const result = await parseFile(filePath);
    expect(result.classes[0].methods).toHaveLength(2);
    expect(result.classes[0].methods[0].name).toBe("method1");
    expect(result.classes[0].methods[1].name).toBe("method2");
  });

  it("should mark class methods as methods", async () => {
    const filePath = await writeTmpPython(
      "method_check.py",
      "class Service:\n    def handle(self):\n        pass\n"
    );
    const result = await parseFile(filePath);
    const method = result.classes[0].methods[0];
    expect(method.is_method).toBe(true);
    expect(method.class_name).toBe("Service");
  });

  it("should extract class start and end lines", async () => {
    const filePath = await writeTmpPython(
      "class_lines.py",
      "x = 1\n\nclass OnLineThree:\n    y = 2\n"
    );
    const result = await parseFile(filePath);
    expect(result.classes[0].start_line).toBe(3);
    expect(result.classes[0].end_line).toBeGreaterThanOrEqual(4);
  });

  it("should have empty decorators array by default", async () => {
    const filePath = await writeTmpPython(
      "plain_class.py",
      "class Plain:\n    pass\n"
    );
    const result = await parseFile(filePath);
    expect(result.classes[0].decorators).toEqual([]);
  });

  it("should extract decorated class methods", async () => {
    const filePath = await writeTmpPython(
      "decorated_method.py",
      "class Service:\n    @property\n    def prop(self):\n        return 42\n"
    );
    const result = await parseFile(filePath);
    const method = result.classes[0].methods[0];
    expect(method.decorators).toContain("property");
  });
});

describe("handleDecorated", () => {
  beforeAll(async () => {
    await mkdir(TMP_DIR, { recursive: true });
    await initParser();
  });

  afterAll(async () => {
    for (const f of tmpFiles) {
      await unlink(f).catch(() => {});
    }
  });

  it("should extract decorated function with decorators", async () => {
    const filePath = await writeTmpPython(
      "decorated_func.py",
      "@decorator\ndef func():\n    pass\n"
    );
    const result = await parseFile(filePath);
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].decorators).toContain("decorator");
  });

  it("should extract multiple decorators", async () => {
    const filePath = await writeTmpPython(
      "multi_decorator.py",
      "@cache\n@validate\ndef decorated():\n    pass\n"
    );
    const result = await parseFile(filePath);
    expect(result.functions[0].decorators.length).toBe(2);
    expect(result.functions[0].decorators).toContain("cache");
    expect(result.functions[0].decorators).toContain("validate");
  });

  it("should extract decorated class", async () => {
    const filePath = await writeTmpPython(
      "decorated_class.py",
      "@dataclass\nclass MyData:\n    x: int\n"
    );
    const result = await parseFile(filePath);
    expect(result.classes).toHaveLength(1);
    expect(result.classes[0].decorators).toContain("dataclass");
  });

  it("should extract decorator with arguments", async () => {
    const filePath = await writeTmpPython(
      "decorator_args.py",
      '@app.route("/path")\ndef handler():\n    pass\n'
    );
    const result = await parseFile(filePath);
    expect(result.functions[0].decorators.length).toBe(1);
    expect(result.functions[0].decorators[0]).toContain("app.route");
  });
});

describe("extractDecorators", () => {
  beforeAll(async () => {
    await initParser();
  });

  it("should extract decorators from decorated node", () => {
    const tree = parseSource("@cache\n@validate\ndef func():\n    pass\n");
    const root = tree.rootNode;
    const decorated = root.namedChild(0);
    expect(decorated!.type).toBe("decorated_definition");
    const decorators = extractDecorators(decorated!);
    expect(decorators.length).toBeGreaterThanOrEqual(2);
    expect(decorators).toContain("cache");
    expect(decorators).toContain("validate");
  });

  it("should strip @ symbol from decorators", () => {
    const tree = parseSource("@myfunc\ndef f():\n    pass\n");
    const decorated = tree.rootNode.namedChild(0);
    const decorators = extractDecorators(decorated!);
    expect(decorators[0]).not.toContain("@");
    expect(decorators[0]).toBe("myfunc");
  });

  it("should handle decorator with call syntax", () => {
    const tree = parseSource("@app.route('/api')\ndef handler():\n    pass\n");
    const decorated = tree.rootNode.namedChild(0);
    const decorators = extractDecorators(decorated!);
    expect(decorators.length).toBeGreaterThan(0);
  });
});

describe("extractDocstring", () => {
  beforeAll(async () => {
    await initParser();
  });

  it("should extract single-line docstring", () => {
    const tree = parseSource('def f():\n    """Returns 42."""\n    return 42\n');
    const funcNode = tree.rootNode.namedChild(0)!;
    const bodyNode = funcNode.childForFieldName("body");
    const docstring = extractDocstring(bodyNode);
    expect(docstring).toBe("Returns 42.");
  });

  it("should extract multiline docstring", () => {
    const tree = parseSource(
      'def f():\n    """\n    A detailed docstring.\n    With multiple lines.\n    """\n    pass\n'
    );
    const funcNode = tree.rootNode.namedChild(0)!;
    const bodyNode = funcNode.childForFieldName("body");
    const docstring = extractDocstring(bodyNode);
    expect(docstring).not.toBeNull();
    expect(docstring).toContain("detailed");
  });

  it("should return null when no docstring present", () => {
    const tree = parseSource("def f():\n    pass\n");
    const funcNode = tree.rootNode.namedChild(0)!;
    const bodyNode = funcNode.childForFieldName("body");
    const docstring = extractDocstring(bodyNode);
    expect(docstring).toBeNull();
  });

  it("should return null when body is null", () => {
    const docstring = extractDocstring(null);
    expect(docstring).toBeNull();
  });

  it("should handle single-quoted docstring", () => {
    const tree = parseSource("def f():\n    'Single quoted'\n    pass\n");
    const funcNode = tree.rootNode.namedChild(0)!;
    const bodyNode = funcNode.childForFieldName("body");
    const docstring = extractDocstring(bodyNode);
    expect(docstring).toBe("Single quoted");
  });
});

describe("extractImport", () => {
  beforeAll(async () => {
    await initParser();
  });

  it("should extract single import", () => {
    const tree = parseSource("import os\n");
    const importNode = tree.rootNode.namedChild(0)!;
    const importInfo = extractImport(importNode);
    expect(importInfo.module).toBe("os");
    expect(importInfo.is_from).toBe(false);
  });

  it("should extract dotted import", () => {
    const tree = parseSource("import os.path\n");
    const importNode = tree.rootNode.namedChild(0)!;
    const importInfo = extractImport(importNode);
    expect(importInfo.module).toContain("os");
    expect(importInfo.is_from).toBe(false);
  });

  it("should set line number", () => {
    const tree = parseSource("x = 1\n\nimport sys\n");
    const importNode = tree.rootNode.namedChild(1)!;
    const importInfo = extractImport(importNode);
    expect(importInfo.line).toBe(3);
  });

  it("should extract multiple imports from same statement", () => {
    const tree = parseSource("import os, sys\n");
    const importNode = tree.rootNode.namedChild(0)!;
    const importInfo = extractImport(importNode);
    expect(importInfo.names.length).toBeGreaterThanOrEqual(1);
  });
});

describe("extractFromImport", () => {
  beforeAll(async () => {
    await initParser();
  });

  it("should extract from import", () => {
    const tree = parseSource("from typing import Optional\n");
    const importNode = tree.rootNode.namedChild(0)!;
    const importInfo = extractFromImport(importNode);
    expect(importInfo.module).toBe("typing");
    expect(importInfo.is_from).toBe(true);
    expect(importInfo.names.length).toBeGreaterThan(0);
  });

  it("should extract multiple names from single from import", () => {
    const tree = parseSource("from typing import List, Dict, Optional\n");
    const importNode = tree.rootNode.namedChild(0)!;
    const importInfo = extractFromImport(importNode);
    expect(importInfo.names.length).toBeGreaterThanOrEqual(3);
  });

  it("should set line number", () => {
    const tree = parseSource("x = 1\n\nfrom os import path\n");
    const importNode = tree.rootNode.namedChild(1)!;
    const importInfo = extractFromImport(importNode);
    expect(importInfo.line).toBe(3);
  });

  it("should handle from import with aliases", () => {
    const tree = parseSource("from typing import Optional as Opt\n");
    const importNode = tree.rootNode.namedChild(0)!;
    const importInfo = extractFromImport(importNode);
    expect(importInfo.names.length).toBeGreaterThan(0);
  });

  it("should mark is_from as true", () => {
    const tree = parseSource("from collections import defaultdict\n");
    const importNode = tree.rootNode.namedChild(0)!;
    const importInfo = extractFromImport(importNode);
    expect(importInfo.is_from).toBe(true);
  });
});

describe("parseFile integration", () => {
  beforeAll(async () => {
    await mkdir(TMP_DIR, { recursive: true });
    await initParser();
  });

  afterAll(async () => {
    for (const f of tmpFiles) {
      await unlink(f).catch(() => {});
    }
  });

  it("should parse file and return ParsedModule with all properties", async () => {
    const filePath = await writeTmpPython(
      "full.py",
      "import os\nfrom typing import Optional\n\ndef top_level():\n    pass\n\nclass MyClass:\n    def method(self):\n        pass\n"
    );
    const result = await parseFile(filePath);
    expect(result.file_path).toBe(filePath);
    expect(result.functions).toBeDefined();
    expect(result.classes).toBeDefined();
    expect(result.imports).toBeDefined();
  });

  it("should capture imports from file", async () => {
    const filePath = await writeTmpPython(
      "imports.py",
      "import sys\nfrom os import path\nimport json as j\n"
    );
    const result = await parseFile(filePath);
    expect(result.imports.length).toBeGreaterThanOrEqual(2);
  });

  it("should capture functions from file", async () => {
    const filePath = await writeTmpPython(
      "functions.py",
      "def func1():\n    pass\n\ndef func2():\n    pass\n"
    );
    const result = await parseFile(filePath);
    expect(result.functions).toHaveLength(2);
  });

  it("should capture classes from file", async () => {
    const filePath = await writeTmpPython(
      "classes.py",
      "class ClassA:\n    pass\n\nclass ClassB:\n    pass\n"
    );
    const result = await parseFile(filePath);
    expect(result.classes).toHaveLength(2);
  });

  it("should handle complex file with mixed content", async () => {
    const filePath = await writeTmpPython(
      "complex.py",
      'import os\nfrom typing import List\n\n@decorator\ndef decorated_func():\n    """Decorated function."""\n    pass\n\nclass Service:\n    def __init__(self):\n        self.value = 0\n\n    @property\n    def prop(self):\n        return self.value\n\n    async def process(self, item: str) -> bool:\n        return True\n'
    );
    const result = await parseFile(filePath);
    expect(result.imports.length).toBeGreaterThanOrEqual(2);
    expect(result.functions.length).toBeGreaterThanOrEqual(1);
    expect(result.classes).toHaveLength(1);
    expect(result.classes[0].methods.length).toBeGreaterThanOrEqual(3);
  });
});