import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { parseFile, initParser } from "../../packages/ast/src/parser.js";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const TMP_DIR = resolve(tmpdir(), "extractClass-tests");
let tmpCounter = 0;

function tmpPath(): string {
  return resolve(TMP_DIR, `test_${Date.now()}_${tmpCounter++}.py`);
}

async function parseClassFromSource(source: string) {
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

describe("extractClass", () => {
  it("should extract a simple class with no methods", async () => {
    const source = `class Empty:\n    pass\n`;
    const result = await parseClassFromSource(source);

    expect(result.classes).toHaveLength(1);
    expect(result.classes[0].name).toBe("Empty");
    expect(result.classes[0].methods).toHaveLength(0);
    expect(result.classes[0].bases).toHaveLength(0);
    expect(result.classes[0].decorators).toHaveLength(0);
  });

  it("should extract class with base classes", async () => {
    const source = `class Dog(Animal, Serializable):\n    pass\n`;
    const result = await parseClassFromSource(source);

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
    const result = await parseClassFromSource(source);

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
    const result = await parseClassFromSource(source);

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
    const result = await parseClassFromSource(source);

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
    const result = await parseClassFromSource(source);

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
    const result = await parseClassFromSource(source);

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
    const result = await parseClassFromSource(source);

    expect(result.classes).toHaveLength(2);
    expect(result.classes[0].name).toBe("First");
    expect(result.classes[1].name).toBe("Second");
    expect(result.classes[1].bases).toEqual(["First"]);
    expect(result.classes[1].methods).toHaveLength(1);
  });

  it("should handle class with no body methods (only pass)", async () => {
    const source = `class Abstract(Base):\n    pass\n`;
    const result = await parseClassFromSource(source);

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
    const result = await parseClassFromSource(source);

    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].name).toBe("standalone");
    expect(result.classes).toHaveLength(1);
    expect(result.classes[0].methods).toHaveLength(1);
    expect(result.classes[0].methods[0].name).toBe("method");
  });
});
