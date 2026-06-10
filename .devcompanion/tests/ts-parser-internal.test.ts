import { describe, it, expect } from "vitest";
import {
  extractTsFunction,
  extractArrowFunctions,
  extractTsParams,
  extractTsClass,
  extractTsMethod,
  extractTsDecorators,
  extractJsDoc,
  extractTsImport,
  handleExportStatement,
  cleanTypeAnnotation,
} from "../../packages/ast/src/ts-parser.js";
import type { FunctionSignature, ClassInfo, ImportInfo } from "../../packages/ast/src/types.js";

function createMockNode(overrides: Record<string, any> = {}): any {
  return {
    type: "function_declaration",
    text: "function test(a: string): number { return 42; }",
    startPosition: { row: 0, column: 0 },
    endPosition: { row: 2, column: 1 },
    childCount: 0,
    namedChildCount: 0,
    namedChild: () => null,
    child: () => null,
    childForFieldName: (name: string) => null,
    previousSibling: null,
    previousNamedSibling: null,
    namedChildren: [],
    ...overrides,
  };
}

function createFunctionNode(opts: {
  name?: string;
  params?: any[];
  returnType?: string;
  isAsync?: boolean;
  docComment?: string;
} = {}): any {
  const {
    name = "test",
    params = [],
    returnType = null,
    isAsync = false,
    docComment = null,
  } = opts;

  const paramNodes = params.map((p) => ({
    type: p.optional ? "optional_parameter" : "required_parameter",
    childForFieldName: (field: string) => {
      if (field === "name" || field === "pattern") return { text: p.name };
      if (field === "type") return p.type ? { text: `: ${p.type}` } : null;
      if (field === "value") return p.default ? { text: p.default } : null;
      return null;
    },
  }));

  const paramsNode = params.length > 0
    ? { namedChildCount: paramNodes.length, namedChild: (i: number) => paramNodes[i] }
    : null;

  const prefix = isAsync ? "async " : "";
  const prevSibling = docComment
    ? { type: "comment", text: `/** ${docComment} */` }
    : null;

  return createMockNode({
    type: "function_declaration",
    text: `${prefix}function ${name}() {}`,
    childForFieldName: (field: string) => {
      if (field === "name") return { text: name };
      if (field === "parameters") return paramsNode;
      if (field === "return_type") return returnType ? { text: `: ${returnType}` } : null;
      return null;
    },
    previousSibling: prevSibling,
    previousNamedSibling: null,
  });
}

describe("ts-parser internal functions", () => {
  describe("cleanTypeAnnotation", () => {
    it("should strip leading colon and whitespace", () => {
      expect(cleanTypeAnnotation(": string")).toBe("string");
    });

    it("should strip colon with extra space", () => {
      expect(cleanTypeAnnotation(":   number")).toBe("number");
    });

    it("should return as-is when no leading colon", () => {
      expect(cleanTypeAnnotation("string")).toBe("string");
    });

    it("should handle complex types", () => {
      expect(cleanTypeAnnotation(": Promise<string[]>")).toBe("Promise<string[]>");
    });

    it("should trim surrounding whitespace after colon removal", () => {
      expect(cleanTypeAnnotation(": boolean  ")).toBe("boolean");
    });
  });

  describe("extractTsFunction", () => {
    it("should extract function name", () => {
      const node = createFunctionNode({ name: "myFunc" });
      const result = extractTsFunction(node, null);
      expect(result.name).toBe("myFunc");
    });

    it("should set is_method false when no class", () => {
      const node = createFunctionNode({ name: "standalone" });
      const result = extractTsFunction(node, null);
      expect(result.is_method).toBe(false);
      expect(result.class_name).toBeNull();
    });

    it("should set is_method true with class name", () => {
      const node = createFunctionNode({ name: "method" });
      const result = extractTsFunction(node, "MyClass");
      expect(result.is_method).toBe(true);
      expect(result.class_name).toBe("MyClass");
    });

    it("should detect async functions", () => {
      const node = createFunctionNode({ name: "fetchData", isAsync: true });
      const result = extractTsFunction(node, null);
      expect(result.is_async).toBe(true);
    });

    it("should detect non-async functions", () => {
      const node = createFunctionNode({ name: "compute", isAsync: false });
      const result = extractTsFunction(node, null);
      expect(result.is_async).toBe(false);
    });

    it("should extract return type", () => {
      const node = createFunctionNode({ name: "fn", returnType: "Promise<void>" });
      const result = extractTsFunction(node, null);
      expect(result.return_type).toBe("Promise<void>");
    });

    it("should handle missing return type", () => {
      const node = createFunctionNode({ name: "fn", returnType: null });
      const result = extractTsFunction(node, null);
      expect(result.return_type).toBeNull();
    });

    it("should extract parameters", () => {
      const node = createFunctionNode({
        name: "fn",
        params: [
          { name: "a", type: "string" },
          { name: "b", type: "number" },
        ],
      });
      const result = extractTsFunction(node, null);
      expect(result.params).toHaveLength(2);
      expect(result.params[0].name).toBe("a");
      expect(result.params[0].type).toBe("string");
      expect(result.params[1].name).toBe("b");
      expect(result.params[1].type).toBe("number");
    });

    it("should extract start and end lines (1-based)", () => {
      const node = createFunctionNode({ name: "fn" });
      const result = extractTsFunction(node, null);
      expect(result.start_line).toBe(1);
      expect(result.end_line).toBe(3);
    });
  });

  describe("extractTsParams", () => {
    it("should return empty array for no params", () => {
      const node = { namedChildCount: 0, namedChild: () => null };
      const result = extractTsParams(node as any);
      expect(result).toEqual([]);
    });

    it("should extract required parameter", () => {
      const paramNode = {
        type: "required_parameter",
        childForFieldName: (f: string) => {
          if (f === "name" || f === "pattern") return { text: "x" };
          if (f === "type") return { text: ": number" };
          if (f === "value") return null;
          return null;
        },
      };
      const node = { namedChildCount: 1, namedChild: () => paramNode };
      const result = extractTsParams(node as any);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("x");
      expect(result[0].type).toBe("number");
      expect(result[0].default_value).toBeNull();
      expect(result[0].is_args).toBe(false);
    });

    it("should extract optional parameter with default", () => {
      const paramNode = {
        type: "optional_parameter",
        childForFieldName: (f: string) => {
          if (f === "name" || f === "pattern") return { text: "limit" };
          if (f === "type") return { text: ": number" };
          if (f === "value") return { text: "10" };
          return null;
        },
      };
      const node = { namedChildCount: 1, namedChild: () => paramNode };
      const result = extractTsParams(node as any);
      expect(result[0].name).toBe("limit");
      expect(result[0].default_value).toBe("10");
    });

    it("should extract rest parameter", () => {
      const paramNode = {
        type: "rest_parameter",
        childForFieldName: (f: string) => {
          if (f === "name" || f === "pattern") return { text: "args" };
          if (f === "type") return { text: ": string[]" };
          return null;
        },
      };
      const node = { namedChildCount: 1, namedChild: () => paramNode };
      const result = extractTsParams(node as any);
      expect(result[0].name).toBe("args");
      expect(result[0].is_args).toBe(true);
      expect(result[0].type).toBe("string[]");
    });
  });

  describe("extractJsDoc", () => {
    it("should return null when no previous sibling", () => {
      const node = createMockNode({ previousSibling: null });
      expect(extractJsDoc(node)).toBeNull();
    });

    it("should return null for non-JSDoc comment", () => {
      const node = createMockNode({
        previousSibling: { type: "comment", text: "// single line" },
      });
      expect(extractJsDoc(node)).toBeNull();
    });

    it("should extract JSDoc content", () => {
      const node = createMockNode({
        previousSibling: { type: "comment", text: "/** Returns the sum */"},
      });
      expect(extractJsDoc(node)).toBe("Returns the sum");
    });

    it("should handle multiline JSDoc", () => {
      const node = createMockNode({
        previousSibling: {
          type: "comment",
          text: "/**\n * First line\n * Second line\n */",
        },
      });
      const result = extractJsDoc(node);
      expect(result).toContain("First line");
      expect(result).toContain("Second line");
    });
  });

  describe("extractTsDecorators", () => {
    it("should return empty array when no decorators", () => {
      const node = createMockNode({ previousNamedSibling: null });
      const result = extractTsDecorators(node);
      expect(result).toEqual([]);
    });

    it("should extract single decorator", () => {
      const decorator = {
        type: "decorator",
        text: "@Injectable",
        previousNamedSibling: null,
      };
      const node = createMockNode({ previousNamedSibling: decorator });
      const result = extractTsDecorators(node);
      expect(result).toEqual(["Injectable"]);
    });

    it("should extract multiple decorators in order", () => {
      const first = {
        type: "decorator",
        text: "@Log",
        previousNamedSibling: null,
      };
      const second = {
        type: "decorator",
        text: "@Validate",
        previousNamedSibling: first,
      };
      const node = createMockNode({ previousNamedSibling: second });
      const result = extractTsDecorators(node);
      expect(result).toEqual(["Log", "Validate"]);
    });
  });

  describe("extractTsImport", () => {
    it("should extract module name", () => {
      const node = createMockNode({
        type: "import_statement",
        namedChildCount: 1,
        childForFieldName: (f: string) => {
          if (f === "source") return { text: "'react'" };
          return null;
        },
        namedChild: (i: number) => ({
          type: "import_clause",
          namedChildCount: 1,
          namedChild: () => ({ type: "identifier", text: "React" }),
        }),
      });
      const result = extractTsImport(node);
      expect(result.module).toBe("react");
      expect(result.names).toContain("React");
      expect(result.is_from).toBe(true);
    });

    it("should extract named imports", () => {
      const specifier = { type: "import_specifier", text: "useState" };
      const namedImports = {
        type: "named_imports",
        namedChildCount: 1,
        namedChild: () => specifier,
      };
      const clause = {
        type: "import_clause",
        namedChildCount: 1,
        namedChild: () => namedImports,
      };
      const node = createMockNode({
        type: "import_statement",
        namedChildCount: 1,
        childForFieldName: (f: string) => {
          if (f === "source") return { text: "\"react\"" };
          return null;
        },
        namedChild: () => clause,
      });
      const result = extractTsImport(node);
      expect(result.module).toBe("react");
      expect(result.names).toContain("useState");
    });
  });

  describe("extractTsClass", () => {
    it("should extract class name", () => {
      const node = createMockNode({
        type: "class_declaration",
        childForFieldName: (f: string) => {
          if (f === "name") return { text: "UserService" };
          if (f === "body") return { namedChildCount: 0, namedChild: () => null };
          return null;
        },
        namedChildren: [],
      });
      const result = extractTsClass(node);
      expect(result.name).toBe("UserService");
      expect(result.methods).toEqual([]);
      expect(result.bases).toEqual([]);
    });

    it("should extract base classes from extends", () => {
      const extendsClause = {
        type: "extends_clause",
        namedChildCount: 1,
        namedChild: () => ({ text: "BaseService" }),
      };
      const heritage = {
        type: "class_heritage",
        namedChildCount: 1,
        namedChild: () => extendsClause,
      };
      const node = createMockNode({
        type: "class_declaration",
        childForFieldName: (f: string) => {
          if (f === "name") return { text: "ChildService" };
          if (f === "body") return { namedChildCount: 0, namedChild: () => null };
          return null;
        },
        namedChildren: [heritage],
      });
      const result = extractTsClass(node);
      expect(result.name).toBe("ChildService");
      expect(result.bases).toContain("BaseService");
    });
  });

  describe("extractTsMethod", () => {
    it("should extract method name and class", () => {
      const node = createMockNode({
        type: "method_definition",
        text: "getData() {}",
        childForFieldName: (f: string) => {
          if (f === "name") return { text: "getData" };
          if (f === "parameters") return { namedChildCount: 0, namedChild: () => null };
          if (f === "return_type") return null;
          return null;
        },
        namedChildren: [],
        previousNamedSibling: null,
      });
      const result = extractTsMethod(node, "ApiClient");
      expect(result.name).toBe("getData");
      expect(result.is_method).toBe(true);
      expect(result.class_name).toBe("ApiClient");
    });

    it("should detect async method", () => {
      const asyncNode = { type: "async" };
      const node = createMockNode({
        type: "method_definition",
        text: "async fetchData() {}",
        childForFieldName: (f: string) => {
          if (f === "name") return { text: "fetchData" };
          if (f === "parameters") return { namedChildCount: 0, namedChild: () => null };
          if (f === "return_type") return null;
          return null;
        },
        namedChildren: [asyncNode],
        previousNamedSibling: null,
      });
      const result = extractTsMethod(node, "Service");
      expect(result.is_async).toBe(true);
    });
  });

  describe("extractArrowFunctions", () => {
    it("should extract arrow function from lexical declaration", () => {
      const functions: FunctionSignature[] = [];
      const arrowNode = {
        type: "arrow_function",
        text: "(x: number) => x * 2",
        childForFieldName: (f: string) => {
          if (f === "parameters") return {
            namedChildCount: 1,
            namedChild: () => ({
              type: "required_parameter",
              childForFieldName: (pf: string) => {
                if (pf === "name" || pf === "pattern") return { text: "x" };
                if (pf === "type") return { text: ": number" };
                return null;
              },
            }),
          };
          if (f === "return_type") return null;
          return null;
        },
      };
      const declarator = {
        type: "variable_declarator",
        childForFieldName: (f: string) => {
          if (f === "name") return { text: "double" };
          if (f === "value") return arrowNode;
          return null;
        },
      };
      const node = createMockNode({
        type: "lexical_declaration",
        text: "const double = (x: number) => x * 2",
        namedChildCount: 1,
        namedChild: () => declarator,
        previousSibling: null,
      });

      extractArrowFunctions(node, functions);
      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe("double");
      expect(functions[0].params[0].name).toBe("x");
      expect(functions[0].is_method).toBe(false);
    });

    it("should skip non-arrow declarations", () => {
      const functions: FunctionSignature[] = [];
      const declarator = {
        type: "variable_declarator",
        childForFieldName: (f: string) => {
          if (f === "name") return { text: "x" };
          if (f === "value") return { type: "number", text: "42" };
          return null;
        },
      };
      const node = createMockNode({
        type: "lexical_declaration",
        namedChildCount: 1,
        namedChild: () => declarator,
        previousSibling: null,
      });

      extractArrowFunctions(node, functions);
      expect(functions).toHaveLength(0);
    });
  });

  describe("handleExportStatement", () => {
    it("should extract exported function declaration", () => {
      const functions: FunctionSignature[] = [];
      const classes: ClassInfo[] = [];
      const imports: ImportInfo[] = [];

      const funcNode = createFunctionNode({ name: "exported" });
      funcNode.type = "function_declaration";

      const exportNode = createMockNode({
        type: "export_statement",
        namedChildCount: 1,
        namedChild: () => funcNode,
      });

      handleExportStatement(exportNode, functions, classes, imports);
      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe("exported");
    });
  });
});
