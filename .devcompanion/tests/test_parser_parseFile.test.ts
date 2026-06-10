import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  extractFunction,
  extractParams,
  extractClass,
  extractDecorators,
  extractDocstring,
  extractImport,
  extractFromImport,
  parseSource,
  parseFile,
} from "../../packages/ast/src/parser.js";

vi.mock("node:fs/promises");
vi.mock("node:fs");
vi.mock("web-tree-sitter");

function createMockNode(config: {
  type: string;
  text?: string;
  startPosition?: { row: number; column: number };
  endPosition?: { row: number; column: number };
  namedChildren?: any[];
  children?: any[];
  parent?: any;
}): any {
  const {
    type,
    text = "",
    startPosition = { row: 0, column: 0 },
    endPosition = { row: 0, column: 0 },
    namedChildren = [],
    children = [],
  } = config;

  return {
    type,
    text,
    startPosition,
    endPosition,
    namedChildren,
    namedChildCount: namedChildren.length,
    childCount: children.length,
    child: vi.fn((i) => children[i] ?? null),
    namedChild: vi.fn((i) => namedChildren[i] ?? null),
    childForFieldName: vi.fn(() => null),
    parent: config.parent ?? null,
    previousNamedSibling: null,
  };
}

describe("Parser Module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("extractFunction", () => {
    it("should extract function name and basic properties", () => {
      const nameNode = createMockNode({ type: "identifier", text: "greet" });
      const node = createMockNode({
        type: "function_definition",
        text: "def greet():\n  pass",
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 1, column: 6 },
      });

      node.childForFieldName = vi.fn((field) => {
        if (field === "name") return nameNode;
        return null;
      });

      const result = extractFunction(node, null);

      expect(result.name).toBe("greet");
      expect(result.is_method).toBe(false);
      expect(result.class_name).toBeNull();
      expect(result.start_line).toBe(1);
      expect(result.end_line).toBe(2);
    });

    it("should mark function as method when class name provided", () => {
      const nameNode = createMockNode({ type: "identifier", text: "method" });
      const node = createMockNode({
        type: "function_definition",
        text: "def method(self):\n  pass",
      });

      node.childForFieldName = vi.fn((field) => {
        if (field === "name") return nameNode;
        return null;
      });

      const result = extractFunction(node, "TestClass");

      expect(result.is_method).toBe(true);
      expect(result.class_name).toBe("TestClass");
    });

    it("should detect async functions", () => {
      const nameNode = createMockNode({ type: "identifier", text: "fetch" });
      const node = createMockNode({
        type: "function_definition",
        text: "async def fetch():\n  pass",
      });

      node.childForFieldName = vi.fn((field) => {
        if (field === "name") return nameNode;
        return null;
      });

      const result = extractFunction(node, null);

      expect(result.is_async).toBe(true);
    });

    it("should extract return type annotation", () => {
      const nameNode = createMockNode({ type: "identifier", text: "getValue" });
      const returnTypeNode = createMockNode({ type: "type", text: "str" });

      const node = createMockNode({
        type: "function_definition",
        text: "def getValue() -> str:\n  pass",
      });

      node.childForFieldName = vi.fn((field) => {
        if (field === "name") return nameNode;
        if (field === "return_type") return returnTypeNode;
        return null;
      });

      const result = extractFunction(node, null);

      expect(result.return_type).toBe("str");
    });

    it("should extract function parameters", () => {
      const nameNode = createMockNode({ type: "identifier", text: "add" });
      const paramNode = createMockNode({ type: "identifier", text: "a" });
      const paramNode2 = createMockNode({ type: "identifier", text: "b" });

      const paramsNode = createMockNode({
        type: "parameters",
        namedChildren: [paramNode, paramNode2],
      });

      paramsNode.namedChild = vi.fn((i) =>
        i === 0 ? paramNode : i === 1 ? paramNode2 : null
      );

      const node = createMockNode({
        type: "function_definition",
        text: "def add(a, b):\n  pass",
      });

      node.childForFieldName = vi.fn((field) => {
        if (field === "name") return nameNode;
        if (field === "parameters") return paramsNode;
        return null;
      });

      const result = extractFunction(node, null);

      expect(result.params).toHaveLength(2);
      expect(result.params[0].name).toBe("a");
      expect(result.params[1].name).toBe("b");
    });

    it("should extract docstring from function body", () => {
      const nameNode = createMockNode({ type: "identifier", text: "documented" });
      const stringNode = createMockNode({
        type: "string",
        text: '"""This is a docstring"""',
      });

      const exprNode = createMockNode({
        type: "expression_statement",
        namedChildren: [stringNode],
      });

      exprNode.namedChild = vi.fn((i) => (i === 0 ? stringNode : null));

      const bodyNode = createMockNode({
        type: "block",
        namedChildren: [exprNode],
      });

      bodyNode.namedChild = vi.fn((i) => (i === 0 ? exprNode : null));

      const node = createMockNode({
        type: "function_definition",
        text: "def documented():\n  pass",
      });

      node.childForFieldName = vi.fn((field) => {
        if (field === "name") return nameNode;
        if (field === "body") return bodyNode;
        return null;
      });

      const result = extractFunction(node, null);

      expect(result.docstring).toBe("This is a docstring");
    });
  });

  describe("extractParams", () => {
    it("should extract simple identifier parameter", () => {
      const paramNode = createMockNode({ type: "identifier", text: "x" });
      const paramsNode = createMockNode({
        type: "parameters",
        namedChildren: [paramNode],
      });

      paramsNode.namedChild = vi.fn((i) => (i === 0 ? paramNode : null));

      const result = extractParams(paramsNode);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: "x",
        type: null,
        default_value: null,
        is_args: false,
        is_kwargs: false,
      });
    });

    it("should extract typed parameter", () => {
      const nameNode = createMockNode({ type: "identifier", text: "count" });
      const typeNode = createMockNode({ type: "type", text: "int" });

      const typedParam = createMockNode({
        type: "typed_parameter",
        namedChildren: [nameNode, typeNode],
      });

      typedParam.childForFieldName = vi.fn((field) => {
        if (field === "name") return nameNode;
        if (field === "type") return typeNode;
        return null;
      });

      typedParam.namedChild = vi.fn((i) =>
        i === 0 ? nameNode : i === 1 ? typeNode : null
      );

      const paramsNode = createMockNode({
        type: "parameters",
        namedChildren: [typedParam],
      });

      paramsNode.namedChild = vi.fn((i) => (i === 0 ? typedParam : null));

      const result = extractParams(paramsNode);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("count");
      expect(result[0].type).toBe("int");
    });

    it("should extract default parameter", () => {
      const nameNode = createMockNode({ type: "identifier", text: "timeout" });
      const valueNode = createMockNode({ type: "number", text: "30" });

      const defaultParam = createMockNode({
        type: "default_parameter",
        namedChildren: [nameNode, valueNode],
      });

      defaultParam.childForFieldName = vi.fn((field) => {
        if (field === "name") return nameNode;
        if (field === "value") return valueNode;
        return null;
      });

      defaultParam.namedChild = vi.fn((i) =>
        i === 0 ? nameNode : i === 1 ? valueNode : null
      );

      const paramsNode = createMockNode({
        type: "parameters",
        namedChildren: [defaultParam],
      });

      paramsNode.namedChild = vi.fn((i) => (i === 0 ? defaultParam : null));

      const result = extractParams(paramsNode);

      expect(result[0].name).toBe("timeout");
      expect(result[0].default_value).toBe("30");
    });

    it("should extract typed default parameter", () => {
      const nameNode = createMockNode({ type: "identifier", text: "retries" });
      const typeNode = createMockNode({ type: "type", text: "int" });
      const valueNode = createMockNode({ type: "number", text: "3" });

      const typedDefaultParam = createMockNode({
        type: "typed_default_parameter",
        namedChildren: [nameNode, typeNode, valueNode],
      });

      typedDefaultParam.childForFieldName = vi.fn((field) => {
        if (field === "name") return nameNode;
        if (field === "type") return typeNode;
        if (field === "value") return valueNode;
        return null;
      });

      typedDefaultParam.namedChild = vi.fn((i) => {
        if (i === 0) return nameNode;
        if (i === 1) return typeNode;
        if (i === 2) return valueNode;
        return null;
      });

      const paramsNode = createMockNode({
        type: "parameters",
        namedChildren: [typedDefaultParam],
      });

      paramsNode.namedChild = vi.fn((i) => (i === 0 ? typedDefaultParam : null));

      const result = extractParams(paramsNode);

      expect(result[0].name).toBe("retries");
      expect(result[0].type).toBe("int");
      expect(result[0].default_value).toBe("3");
    });

    it("should extract *args parameter", () => {
      const argsNameNode = createMockNode({ type: "identifier", text: "args" });

      const argsParam = createMockNode({
        type: "list_splat_pattern",
        namedChildren: [argsNameNode],
      });

      argsParam.namedChild = vi.fn((i) => (i === 0 ? argsNameNode : null));

      const paramsNode = createMockNode({
        type: "parameters",
        namedChildren: [argsParam],
      });

      paramsNode.namedChild = vi.fn((i) => (i === 0 ? argsParam : null));

      const result = extractParams(paramsNode);

      expect(result[0].name).toBe("args");
      expect(result[0].is_args).toBe(true);
      expect(result[0].is_kwargs).toBe(false);
    });

    it("should extract **kwargs parameter", () => {
      const kwargsNameNode = createMockNode({ type: "identifier", text: "kwargs" });

      const kwargsParam = createMockNode({
        type: "dictionary_splat_pattern",
        namedChildren: [kwargsNameNode],
      });

      kwargsParam.namedChild = vi.fn((i) => (i === 0 ? kwargsNameNode : null));

      const paramsNode = createMockNode({
        type: "parameters",
        namedChildren: [kwargsParam],
      });

      paramsNode.namedChild = vi.fn((i) => (i === 0 ? kwargsParam : null));

      const result = extractParams(paramsNode);

      expect(result[0].name).toBe("kwargs");
      expect(result[0].is_kwargs).toBe(true);
    });

    it("should handle empty parameter list", () => {
      const paramsNode = createMockNode({
        type: "parameters",
        namedChildren: [],
      });

      paramsNode.namedChild = vi.fn(() => null);

      const result = extractParams(paramsNode);

      expect(result).toHaveLength(0);
    });
  });

  describe("extractClass", () => {
    it("should extract class name and structure", () => {
      const nameNode = createMockNode({ type: "identifier", text: "Animal" });
      const bodyNode = createMockNode({
        type: "block",
        namedChildren: [],
      });

      bodyNode.namedChild = vi.fn(() => null);

      const classNode = createMockNode({
        type: "class_definition",
        text: "class Animal:\n  pass",
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 1, column: 6 },
      });

      classNode.childForFieldName = vi.fn((field) => {
        if (field === "name") return nameNode;
        if (field === "body") return bodyNode;
        return null;
      });

      const result = extractClass(classNode);

      expect(result.name).toBe("Animal");
      expect(result.methods).toHaveLength(0);
      expect(result.bases).toHaveLength(0);
      expect(result.start_line).toBe(1);
      expect(result.end_line).toBe(2);
    });

    it("should extract single base class", () => {
      const nameNode = createMockNode({ type: "identifier", text: "Dog" });
      const baseNode = createMockNode({ type: "identifier", text: "Animal" });

      const superclassNode = createMockNode({
        type: "argument_list",
        namedChildren: [baseNode],
      });

      superclassNode.namedChild = vi.fn((i) => (i === 0 ? baseNode : null));

      const bodyNode = createMockNode({
        type: "block",
        namedChildren: [],
      });

      bodyNode.namedChild = vi.fn(() => null);

      const classNode = createMockNode({
        type: "class_definition",
        text: "class Dog(Animal):\n  pass",
      });

      classNode.childForFieldName = vi.fn((field) => {
        if (field === "name") return nameNode;
        if (field === "superclasses") return superclassNode;
        if (field === "body") return bodyNode;
        return null;
      });

      const result = extractClass(classNode);

      expect(result.bases).toEqual(["Animal"]);
    });

    it("should extract multiple base classes", () => {
      const nameNode = createMockNode({ type: "identifier", text: "Robot" });
      const baseNode1 = createMockNode({ type: "identifier", text: "Machine" });
      const baseNode2 = createMockNode({ type: "identifier", text: "Smart" });

      const superclassNode = createMockNode({
        type: "argument_list",
        namedChildren: [baseNode1, baseNode2],
      });

      superclassNode.namedChild = vi.fn((i) =>
        i === 0 ? baseNode1 : i === 1 ? baseNode2 : null
      );

      const bodyNode = createMockNode({
        type: "block",
        namedChildren: [],
      });

      bodyNode.namedChild = vi.fn(() => null);

      const classNode = createMockNode({
        type: "class_definition",
        text: "class Robot(Machine, Smart):\n  pass",
      });

      classNode.childForFieldName = vi.fn((field) => {
        if (field === "name") return nameNode;
        if (field === "superclasses") return superclassNode;
        if (field === "body") return bodyNode;
        return null;
      });

      const result = extractClass(classNode);

      expect(result.bases).toEqual(["Machine", "Smart"]);
    });

    it("should extract class methods", () => {
      const nameNode = createMockNode({ type: "identifier", text: "Calculator" });
      const methodNameNode = createMockNode({ type: "identifier", text: "add" });

      const methodNode = createMockNode({
        type: "function_definition",
        text: "def add(self, a, b):\n  pass",
        startPosition: { row: 1, column: 2 },
        endPosition: { row: 2, column: 8 },
      });

      methodNode.childForFieldName = vi.fn((field) => {
        if (field === "name") return methodNameNode;
        return null;
      });

      const bodyNode = createMockNode({
        type: "block",
        namedChildren: [methodNode],
      });

      bodyNode.namedChild = vi.fn((i) => (i === 0 ? methodNode : null));

      const classNode = createMockNode({
        type: "class_definition",
        text: "class Calculator:\n  def add(self, a, b):\n    pass",
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 2, column: 8 },
      });

      classNode.childForFieldName = vi.fn((field) => {
        if (field === "name") return nameNode;
        if (field === "body") return bodyNode;
        return null;
      });

      const result = extractClass(classNode);

      expect(result.methods).toHaveLength(1);
      expect(result.methods[0].name).toBe("add");
      expect(result.methods[0].is_method).toBe(true);
      expect(result.methods[0].class_name).toBe("Calculator");
    });

    it("should extract decorated methods", () => {
      const nameNode = createMockNode({ type: "identifier", text: "Service" });
      const decoratorNode = createMockNode({
        type: "decorator",
        text: "@property",
      });

      const methodNameNode = createMockNode({
        type: "identifier",
        text: "status",
      });

      const methodNode = createMockNode({
        type: "function_definition",
        text: "def status(self):\n  pass",
      });

      methodNode.childForFieldName = vi.fn((field) => {
        if (field === "name") return methodNameNode;
        return null;
      });

      const decoratedNode = createMockNode({
        type: "decorated_definition",
        namedChildren: [decoratorNode, methodNode],
      });

      decoratedNode.namedChildren = [decoratorNode, methodNode];

      const bodyNode = createMockNode({
        type: "block",
        namedChildren: [decoratedNode],
      });

      bodyNode.namedChild = vi.fn((i) => (i === 0 ? decoratedNode : null));

      const classNode = createMockNode({
        type: "class_definition",
        text: "class Service:\n  @property\n  def status(self):\n    pass",
      });

      classNode.childForFieldName = vi.fn((field) => {
        if (field === "name") return nameNode;
        if (field === "body") return bodyNode;
        return null;
      });

      const result = extractClass(classNode);

      expect(result.methods).toHaveLength(1);
      expect(result.methods[0].decorators).toContain("property");
    });
  });

  describe("extractDecorators", () => {
    it("should extract single decorator", () => {
      const decoratorNode = createMockNode({
        type: "decorator",
        text: "@dataclass",
      });

      const decoratedNode = createMockNode({
        type: "decorated_definition",
        namedChildren: [decoratorNode],
      });

      decoratedNode.namedChildren = [decoratorNode];

      const result = extractDecorators(decoratedNode);

      expect(result).toEqual(["dataclass"]);
    });

    it("should extract multiple decorators", () => {
      const decorator1 = createMockNode({
        type: "decorator",
        text: "@property",
      });

      const decorator2 = createMockNode({
        type: "decorator",
        text: "@cached",
      });

      const decoratedNode = createMockNode({
        type: "decorated_definition",
        namedChildren: [decorator1, decorator2],
      });

      decoratedNode.namedChildren = [decorator1, decorator2];

      const result = extractDecorators(decoratedNode);

      expect(result).toEqual(["property", "cached"]);
    });

    it("should handle node with no decorators", () => {
      const decoratedNode = createMockNode({
        type: "decorated_definition",
        namedChildren: [],
      });

      decoratedNode.namedChildren = [];

      const result = extractDecorators(decoratedNode);

      expect(result).toHaveLength(0);
    });

    it("should remove @ prefix from decorator names", () => {
      const decoratorNode = createMockNode({
        type: "decorator",
        text: "@staticmethod",
      });

      const decoratedNode = createMockNode({
        type: "decorated_definition",
        namedChildren: [decoratorNode],
      });

      decoratedNode.namedChildren = [decoratorNode];

      const result = extractDecorators(decoratedNode);

      expect(result[0]).toBe("staticmethod");
      expect(result[0]).not.toContain("@");
    });
  });

  describe("extractDocstring", () => {
    it("should extract triple-quoted docstring", () => {
      const stringNode = createMockNode({
        type: "string",
        text: '"""Module documentation."""',
      });

      const exprNode = createMockNode({
        type: "expression_statement",
        namedChildren: [stringNode],
      });

      exprNode.namedChild = vi.fn((i) => (i === 0 ? stringNode : null));

      const bodyNode = createMockNode({
        type: "block",
        namedChildren: [exprNode],
      });

      bodyNode.namedChild = vi.fn((i) => (i === 0 ? exprNode : null));

      const result = extractDocstring(bodyNode);

      expect(result).toBe("Module documentation.");
    });

    it("should extract single-quoted docstring", () => {
      const stringNode = createMockNode({
        type: "string",
        text: "'Simple doc'",
      });

      const exprNode = createMockNode({
        type: "expression_statement",
        namedChildren: [stringNode],
      });

      exprNode.namedChild = vi.fn((i) => (i === 0 ? stringNode : null));

      const bodyNode = createMockNode({
        type: "block",
        namedChildren: [exprNode],
      });

      bodyNode.namedChild = vi.fn((i) => (i === 0 ? exprNode : null));

      const result = extractDocstring(bodyNode);

      expect(result).toBe("Simple doc");
    });

    it("should return null for empty body", () => {
      const result = extractDocstring(null);

      expect(result).toBeNull();
    });

    it("should return null when first statement is not a string", () => {
      const exprNode = createMockNode({
        type: "expression_statement",
        namedChildren: [],
      });

      exprNode.namedChild = vi.fn(() => null);

      const bodyNode = createMockNode({
        type: "block",
        namedChildren: [exprNode],
      });

      bodyNode.namedChild = vi.fn((i) => (i === 0 ? exprNode : null));

      const result = extractDocstring(bodyNode);

      expect(result).toBeNull();
    });

    it("should trim whitespace from docstring", () => {
      const stringNode = createMockNode({
        type: "string",
        text: '"""  \n  Content  \n  """',
      });

      const exprNode = createMockNode({
        type: "expression_statement",
        namedChildren: [stringNode],
      });

      exprNode.namedChild = vi.fn((i) => (i === 0 ? stringNode : null));

      const bodyNode = createMockNode({
        type: "block",
        namedChildren: [exprNode],
      });

      bodyNode.namedChild = vi.fn((i) => (i === 0 ? exprNode : null));

      const result = extractDocstring(bodyNode);

      expect(result?.trim()).toContain("Content");
    });
  });

  describe("extractImport", () => {
    it("should extract simple module import", () => {
      const moduleNode = createMockNode({
        type: "dotted_name",
        text: "os",
      });

      const importNode = createMockNode({
        type: "import_statement",
        namedChildren: [moduleNode],
        startPosition: { row: 0, column: 0 },
      });

      importNode.namedChild = vi.fn((i) => (i === 0 ? moduleNode : null));

      const result = extractImport(importNode);

      expect(result.module).toBe("os");
      expect(result.names).toContain("os");
      expect(result.is_from).toBe(false);
      expect(result.line).toBe(1);
    });

    it("should extract dotted module import", () => {
      const moduleNode = createMockNode({
        type: "dotted_name",
        text: "os.path",
      });

      const importNode = createMockNode({
        type: "import_statement",
        namedChildren: [moduleNode],
        startPosition: { row: 3, column: 0 },
      });

      importNode.namedChild = vi.fn((i) => (i === 0 ? moduleNode : null));

      const result = extractImport(importNode);

      expect(result.module).toBe("os.path");
      expect(result.line).toBe(4);
    });

    it("should extract aliased import", () => {
      const aliasNode = createMockNode({
        type: "aliased_import",
        text: "numpy as np",
      });

      const importNode = createMockNode({
        type: "import_statement",
        namedChildren: [aliasNode],
        startPosition: { row: 0, column: 0 },
      });

      importNode.namedChild = vi.fn((i) => (i === 0 ? aliasNode : null));

      const result = extractImport(importNode);

      expect(result.names).toContain("numpy as np");
    });

    it("should extract multiple imports", () => {
      const import1 = createMockNode({ type: "dotted_name", text: "sys" });
      const import2 = createMockNode({ type: "dotted_name", text: "json" });

      const importNode = createMockNode({
        type: "import_statement",
        namedChildren: [import1, import2],
        startPosition: { row: 0, column: 0 },
      });

      importNode.namedChild = vi.fn((i) => {
        if (i === 0) return import1;
        if (i === 1) return import2;
        return null;
      });

      const result = extractImport(importNode);

      expect(result.names).toContain("sys");
      expect(result.names).toContain("json");
    });
  });

  describe("extractFromImport", () => {
    it("should extract from import with single name", () => {
      const moduleNode = createMockNode({
        type: "dotted_name",
        text: "os",
      });

      const nameNode = createMockNode({
        type: "dotted_name",
        text: "path",
      });

      const fromImportNode = createMockNode({
        type: "import_from_statement",
        namedChildren: [nameNode],
        startPosition: { row: 0, column: 0 },
      });

      fromImportNode.childForFieldName = vi.fn((field) => {
        if (field === "module_name") return moduleNode;
        return null;
      });

      fromImportNode.namedChild = vi.fn((i) => (i === 0 ? nameNode : null));

      const result = extractFromImport(fromImportNode);

      expect(result.module).toBe("os");
      expect(result.names).toContain("path");
      expect(result.is_from).toBe(true);
      expect(result.line).toBe(1);
    });

    it("should extract from import with multiple names", () => {
      const moduleNode = createMockNode({
        type: "dotted_name",
        text: "collections",
      });

      const name1 = createMockNode({
        type: "dotted_name",
        text: "defaultdict",
      });

      const name2 = createMockNode({
        type: "dotted_name",
        text: "Counter",
      });

      const fromImportNode = createMockNode({
        type: "import_from_statement",
        namedChildren: [name1, name2],
        startPosition: { row: 2, column: 0 },
      });

      fromImportNode.childForFieldName = vi.fn((field) => {
        if (field === "module_name") return moduleNode;
        return null;
      });

      fromImportNode.namedChild = vi.fn((i) => {
        if (i === 0) return name1;
        if (i === 1) return name2;
        return null;
      });

      const result = extractFromImport(fromImportNode);

      expect(result.module).toBe("collections");
      expect(result.names).toContain("defaultdict");
      expect(result.names).toContain("Counter");
      expect(result.line).toBe(3);
    });

    it("should extract aliased from import", () => {
      const moduleNode = createMockNode({
        type: "dotted_name",
        text: "typing",
      });

      const aliasNode = createMockNode({
        type: "aliased_import",
        text: "Optional as Opt",
      });

      const fromImportNode = createMockNode({
        type: "import_from_statement",
        namedChildren: [aliasNode],
        startPosition: { row: 0, column: 0 },
      });

      fromImportNode.childForFieldName = vi.fn((field) => {
        if (field === "module_name") return moduleNode;
        return null;
      });

      fromImportNode.namedChild = vi.fn((i) => (i === 0 ? aliasNode : null));

      const result = extractFromImport(fromImportNode);

      expect(result.module).toBe("typing");
      expect(result.names).toContain("Optional as Opt");
    });
  });

  describe("parseSource", () => {
    it("should throw error when parser not initialized", () => {
      expect(() => parseSource("def hello(): pass")).toThrow(
        "Parser not initialized"
      );
    });
  });

  describe("parseFile", () => {
    it("should reject when given null path", async () => {
      await expect(parseFile(null as any)).rejects.toThrow();
    });

    it("should reject when given undefined path", async () => {
      await expect(parseFile(undefined as any)).rejects.toThrow();
    });

    it("should reject when given non-string path", async () => {
      await expect(parseFile(123 as any)).rejects.toThrow();
    });
  });
});
