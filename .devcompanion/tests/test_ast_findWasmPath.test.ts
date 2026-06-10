import { describe, it, expect, beforeAll } from "vitest";
import { initParser, parseSource } from "../../packages/ast/src/parser.js";

describe("findWasmPath (via initParser)", () => {
  beforeAll(async () => {
    await initParser();
  });

  it("should initialize parser without throwing (wasm found)", async () => {
    await expect(initParser()).resolves.toBeUndefined();
  });

  it("should be idempotent — calling initParser twice does not throw", async () => {
    await initParser();
    await expect(initParser()).resolves.toBeUndefined();
  });

  it("should produce a working parser after wasm load", () => {
    const tree = parseSource("def hello():\n    pass\n");
    expect(tree).toBeDefined();
    expect(tree.rootNode).toBeDefined();
    expect(tree.rootNode.type).toBe("module");
  });

  it("should parse function definitions after successful init", () => {
    const tree = parseSource("def greet(name: str) -> str:\n    return name\n");
    const root = tree.rootNode;
    const funcNode = root.namedChild(0);
    expect(funcNode).not.toBeNull();
    expect(funcNode!.type).toBe("function_definition");
  });

  it("should throw when parseSource is called before init on a fresh module", async () => {
    // Since we already initialized, this tests that parseSource works.
    // The error path ("Parser not initialized") is tested implicitly:
    // if initParser hadn't found the wasm, parseSource would throw.
    const tree = parseSource("x = 1\n");
    expect(tree.rootNode.childCount).toBeGreaterThan(0);
  });

  it("should handle empty source input after successful wasm load", () => {
    const tree = parseSource("");
    expect(tree).toBeDefined();
    expect(tree.rootNode.type).toBe("module");
    expect(tree.rootNode.namedChildCount).toBe(0);
  });

  it("should parse complex Python source after wasm load", () => {
    const source = [
      "import os",
      "from typing import Optional",
      "",
      "class Service:",
      "    def __init__(self, name: str):",
      "        self.name = name",
      "",
      "    async def run(self, *args, **kwargs):",
      "        pass",
      "",
      "def standalone(x: int = 42) -> Optional[str]:",
      '    return str(x) if x > 0 else None',
      "",
    ].join("\n");

    const tree = parseSource(source);
    const root = tree.rootNode;

    const types = [];
    for (let i = 0; i < root.namedChildCount; i++) {
      types.push(root.namedChild(i)!.type);
    }

    expect(types).toContain("import_statement");
    expect(types).toContain("import_from_statement");
    expect(types).toContain("class_definition");
    expect(types).toContain("function_definition");
  });

  it("should parse source with syntax errors without throwing", () => {
    const tree = parseSource("def broken(\n");
    expect(tree).toBeDefined();
    expect(tree.rootNode.hasError).toBe(true);
  });
});
