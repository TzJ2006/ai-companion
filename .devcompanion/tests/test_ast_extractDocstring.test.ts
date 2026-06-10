import { describe, it, expect, beforeAll, vi } from "vitest";
import { initParser, parseFile } from "../../packages/ast/src/parser.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: vi.fn(),
  };
});

import { readFile } from "node:fs/promises";
const mockReadFile = vi.mocked(readFile);

beforeAll(async () => {
  await initParser();
});

describe("extractDocstring", () => {
  it("should extract triple-quoted docstring from function", async () => {
    mockReadFile.mockResolvedValue(
      `def greet(name: str) -> str:\n    """Say hello to the user."""\n    return f"Hello, {name}"\n`
    );
    const result = await parseFile("fake.py");
    expect(result.functions[0].docstring).toBe("Say hello to the user.");
  });

  it("should extract single-quoted docstring", async () => {
    mockReadFile.mockResolvedValue(
      `def foo():\n    '''Single quoted docstring.'''\n    pass\n`
    );
    const result = await parseFile("fake.py");
    expect(result.functions[0].docstring).toBe("Single quoted docstring.");
  });

  it("should extract multiline docstring", async () => {
    mockReadFile.mockResolvedValue(
      `def bar():\n    """\n    Multiline\n    docstring content.\n    """\n    pass\n`
    );
    const result = await parseFile("fake.py");
    expect(result.functions[0].docstring).toContain("Multiline");
    expect(result.functions[0].docstring).toContain("docstring content.");
  });

  it("should return null when function has no docstring", async () => {
    mockReadFile.mockResolvedValue(
      `def nodoc():\n    x = 1\n    return x\n`
    );
    const result = await parseFile("fake.py");
    expect(result.functions[0].docstring).toBeNull();
  });

  it("should return null when function body starts with non-string expression", async () => {
    mockReadFile.mockResolvedValue(
      `def compute():\n    result = 42\n    return result\n`
    );
    const result = await parseFile("fake.py");
    expect(result.functions[0].docstring).toBeNull();
  });

  it("should extract docstring from class methods", async () => {
    mockReadFile.mockResolvedValue(
      `class MyClass:\n    def method(self):\n        """Method docstring."""\n        pass\n`
    );
    const result = await parseFile("fake.py");
    expect(result.classes[0].methods[0].docstring).toBe("Method docstring.");
  });

  it("should return null for method without docstring", async () => {
    mockReadFile.mockResolvedValue(
      `class Foo:\n    def bar(self):\n        return 1\n`
    );
    const result = await parseFile("fake.py");
    expect(result.classes[0].methods[0].docstring).toBeNull();
  });

  it("should handle empty function body gracefully", async () => {
    mockReadFile.mockResolvedValue(
      `def empty():\n    pass\n`
    );
    const result = await parseFile("fake.py");
    expect(result.functions[0].docstring).toBeNull();
  });

  it("should not treat a regular string assignment as docstring", async () => {
    mockReadFile.mockResolvedValue(
      `def assign():\n    x = "not a docstring"\n    return x\n`
    );
    const result = await parseFile("fake.py");
    expect(result.functions[0].docstring).toBeNull();
  });

  it("should strip surrounding quotes from docstring content", async () => {
    mockReadFile.mockResolvedValue(
      `def trimmed():\n    """  Whitespace around  """\n    pass\n`
    );
    const result = await parseFile("fake.py");
    expect(result.functions[0].docstring).toBe("Whitespace around");
  });
});
