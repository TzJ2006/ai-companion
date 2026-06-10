import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  findWasmPath,
  extractFunction,
  extractParams,
  extractClass,
  extractDecorators,
  extractDocstring,
  extractImport,
  extractFromImport,
  handleDecorated,
} from "../../packages/ast/src/parser.js";

vi.mock("web-tree-sitter", () => ({
  Parser: { init: vi.fn() },
  Language: { load: vi.fn() },
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn((path: string) => path.includes("tree-sitter-python.wasm")),
}));

describe("parser", () => {
  beforeEach(() => vi.clearAllMocks());
  describe("findWasmPath", () => {
    it("returns path", () => {
      expect(findWasmPath()).toContain("tree-sitter-python.wasm");
    });
  });
  describe("extractFunction", () => {
    it("extracts basic function", () => {
      const node: any = {
        text: "def foo(): pass",
        type: "function_definition",
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 15 },
        childForFieldName: vi.fn((field: string) => {
          if (field === "name") return { text: "foo" };
          if (field === "parameters") return { namedChildCount: 0, namedChild: () => null };
          if (field === "return_type") return null;
          if (field === "body") return { namedChildCount: 0, namedChild: () => null };
          return null;
        }),
        parent: null,
        previousNamedSibling: null,
      };
      const r = extractFunction(node, null);
      expect(r.name).toBe("foo");
      expect(r.is_method).toBe(false);
      expect(r.start_line).toBe(1);
    });
    it("marks method with class", () => {
      const node: any = {
        text: "def method(self): pass",
        type: "function_definition",
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 22 },
        childForFieldName: vi.fn((field: string) => {
          if (field === "name") return { text: "method" };
          if (field === "parameters") return { namedChildCount: 0, namedChild: () => null };
          if (field === "return_type") return null;
          if (field === "body") return { namedChildCount: 0, namedChild: () => null };
          return null;
        }),
        parent: null,
        previousNamedSibling: null,
      };
      const r = extractFunction(node, "MyClass");
      expect(r.is_method).toBe(true);
      expect(r.class_name).toBe("MyClass");
    });
  });
  describe("extractParams", () => {
    it("extracts simple param", () => {
      const node: any = {
        namedChildCount: 1,
        namedChild: vi.fn(() => ({ type: "identifier", text: "x" })),
      };
      const r = extractParams(node);
      expect(r).toHaveLength(1);
      expect(r[0].name).toBe("x");
    });
    it("handles empty", () => {
      expect(extractParams({ namedChildCount: 0, namedChild: () => null })).toEqual([]);
    });
  });
  describe("extractClass", () => {
    it("extracts basic class", () => {
      const node: any = {
        type: "class_definition",
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 14 },
        childForFieldName: vi.fn((f) => (f === "name" ? { text: "Foo" } : f === "body" ? { namedChildCount: 0, namedChild: () => null } : null)),
      };
      const r = extractClass(node);
      expect(r.name).toBe("Foo");
      expect(r.bases).toEqual([]);
    });
  });
  describe("extractDecorators", () => {
    it("extracts list", () => {
      const node: any = {
        namedChildren: [
          { type: "decorator", text: "@app.route" },
          { type: "decorator", text: "@cache" },
        ],
      };
      expect(extractDecorators(node)).toEqual(["app.route", "cache"]);
    });
  });
  describe("extractDocstring", () => {
    it("extracts docstring", () => {
      const node: any = {
        namedChildCount: 1,
        namedChild: vi.fn(() => ({
          type: "expression_statement",
          namedChild: vi.fn(() => ({ type: "string", text: "\"\"\"Test\"\"\"" })),
        })),
      };
      expect(extractDocstring(node)).toBe("Test");
    });
    it("returns null for null input", () => {
      expect(extractDocstring(null)).toBeNull();
    });
  });
  describe("extractImport", () => {
    it("extracts simple import", () => {
      const node: any = {
        type: "import_statement",
        startPosition: { row: 0, column: 0 },
        namedChildCount: 1,
        namedChild: vi.fn(() => ({ type: "dotted_name", text: "os" })),
      };
      const r = extractImport(node);
      expect(r.module).toBe("os");
      expect(r.is_from).toBe(false);
    });
  });
  describe("extractFromImport", () => {
    it("extracts from import", () => {
      const node: any = {
        type: "import_from_statement",
        startPosition: { row: 0, column: 0 },
        childForFieldName: vi.fn(() => ({ text: "os.path" })),
        namedChildCount: 1,
        namedChild: vi.fn(() => ({ type: "dotted_name", text: "join" })),
      };
      const r = extractFromImport(node);
      expect(r.module).toBe("os.path");
      expect(r.is_from).toBe(true);
    });
  });
  describe("handleDecorated", () => {
    it("extracts decorated function", () => {
      const funcNode: any = {
        type: "function_definition",
        text: "def foo(): pass",
        startPosition: { row: 1, column: 0 },
        endPosition: { row: 1, column: 15 },
        childForFieldName: vi.fn((field: string) => {
          if (field === "name") return { text: "foo" };
          if (field === "parameters") return { namedChildCount: 0, namedChild: () => null };
          if (field === "return_type") return null;
          if (field === "body") return { namedChildCount: 0, namedChild: () => null };
          return null;
        }),
        parent: { type: "decorated_definition" },
        previousNamedSibling: null,
      };
      const node: any = {
        type: "decorated_definition",
        namedChildren: [
          { type: "decorator", text: "@route" },
          funcNode,
        ],
      };
      const functions: any[] = [];
      handleDecorated(node, functions, [], null);
      expect(functions).toHaveLength(1);
      expect(functions[0].decorators).toContain("route");
    });
  });
});
