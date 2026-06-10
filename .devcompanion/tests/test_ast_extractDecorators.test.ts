import { describe, it, expect, beforeAll } from "vitest";
import { initParser, parseSource } from "../../packages/ast/src/parser.js";
import { parseFile } from "../../packages/ast/src/parser.js";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tmpDir = join(tmpdir(), "ast-decorator-tests");
let tmpCount = 0;

async function parsePythonSnippet(code: string) {
  const filePath = join(tmpDir, `dec_test_${tmpCount++}.py`);
  await mkdir(tmpDir, { recursive: true });
  await writeFile(filePath, code, "utf-8");
  try {
    return await parseFile(filePath);
  } finally {
    await unlink(filePath).catch(() => {});
  }
}

describe("extractDecorators", () => {
  beforeAll(async () => {
    await initParser();
  });

  it("should extract a single decorator from a function", async () => {
    const result = await parsePythonSnippet(`
@staticmethod
def my_func():
    pass
`);
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].decorators).toEqual(["staticmethod"]);
  });

  it("should extract multiple decorators from a function", async () => {
    const result = await parsePythonSnippet(`
@classmethod
@deprecated
def my_func(cls):
    pass
`);
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].decorators).toContain("classmethod");
    expect(result.functions[0].decorators).toContain("deprecated");
    expect(result.functions[0].decorators).toHaveLength(2);
  });

  it("should extract decorator with arguments", async () => {
    const result = await parsePythonSnippet(`
@app.route("/api")
def handler():
    pass
`);
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].decorators[0]).toBe('app.route("/api")');
  });

  it("should extract decorators from a class", async () => {
    const result = await parsePythonSnippet(`
@dataclass
class MyModel:
    x: int = 0
`);
    expect(result.classes).toHaveLength(1);
    expect(result.classes[0].decorators).toEqual(["dataclass"]);
  });

  it("should extract decorators from class methods", async () => {
    const result = await parsePythonSnippet(`
class Foo:
    @staticmethod
    def bar():
        pass

    @property
    def baz(self):
        return 1
`);
    expect(result.classes).toHaveLength(1);
    const methods = result.classes[0].methods;
    expect(methods).toHaveLength(2);
    expect(methods[0].decorators).toEqual(["staticmethod"]);
    expect(methods[1].decorators).toEqual(["property"]);
  });

  it("should return empty array when no decorators present on function", async () => {
    const result = await parsePythonSnippet(`
def plain_func():
    pass
`);
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].decorators).toEqual([]);
  });

  it("should return empty array when no decorators present on class", async () => {
    const result = await parsePythonSnippet(`
class Plain:
    pass
`);
    expect(result.classes).toHaveLength(1);
    expect(result.classes[0].decorators).toEqual([]);
  });

  it("should handle decorator with complex arguments", async () => {
    const result = await parsePythonSnippet(`
@pytest.mark.parametrize("x,y", [(1, 2), (3, 4)])
def test_add(x, y):
    pass
`);
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].decorators[0]).toContain("pytest.mark.parametrize");
  });

  it("should strip the @ symbol from decorator text", async () => {
    const result = await parsePythonSnippet(`
@override
def method():
    pass
`);
    expect(result.functions[0].decorators[0]).not.toContain("@");
    expect(result.functions[0].decorators[0]).toBe("override");
  });

  it("should handle multiple decorators on a class", async () => {
    const result = await parsePythonSnippet(`
@dataclass
@frozen
class Config:
    host: str = "localhost"
`);
    expect(result.classes[0].decorators).toHaveLength(2);
    expect(result.classes[0].decorators).toContain("dataclass");
    expect(result.classes[0].decorators).toContain("frozen");
  });
});
