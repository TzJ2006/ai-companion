import { describe, it, expect } from "vitest";
import { extractParams, extractFunction, extractClass, extractDecorators, extractDocstring, extractImport, extractFromImport, handleDecorated, } from "./parser.js";
function createMockNode(overrides = {}) {
    const defaults = {
        type: "identifier",
        text: "test",
        namedChildCount: 0,
        childCount: 0,
        startPosition: { row: 0, column: 0 },
        endPosition: { row: 0, column: 4 },
        parent: undefined,
        previousNamedSibling: undefined,
        namedChildren: [],
        child: () => null,
        namedChild: () => null,
        childForFieldName: () => null,
    };
    return { ...defaults, ...overrides };
}
describe("extractParams", () => {
    describe("basic parameter extraction", () => {
        it("should return empty array for node with no children", () => {
            const node = createMockNode({
                namedChildCount: 0,
                namedChildren: [],
            });
            const result = extractParams(node);
            expect(result).toEqual([]);
            expect(Array.isArray(result)).toBe(true);
        });
        it("should extract simple identifier parameter", () => {
            const idNode = createMockNode({
                type: "identifier",
                text: "param1",
            });
            const node = createMockNode({
                namedChildCount: 1,
                namedChildren: [idNode],
                namedChild: (i) => (i === 0 ? idNode : null),
            });
            const result = extractParams(node);
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                name: "param1",
                type: null,
                default_value: null,
                is_args: false,
                is_kwargs: false,
            });
        });
        it("should extract multiple identifier parameters", () => {
            const param1 = createMockNode({ type: "identifier", text: "x" });
            const param2 = createMockNode({ type: "identifier", text: "y" });
            const param3 = createMockNode({ type: "identifier", text: "z" });
            const node = createMockNode({
                namedChildCount: 3,
                namedChildren: [param1, param2, param3],
                namedChild: (i) => [param1, param2, param3][i] || null,
            });
            const result = extractParams(node);
            expect(result).toHaveLength(3);
            expect(result[0].name).toBe("x");
            expect(result[1].name).toBe("y");
            expect(result[2].name).toBe("z");
        });
    });
    describe("typed parameters", () => {
        it("should extract typed_parameter with type annotation", () => {
            const nameNode = createMockNode({ type: "identifier", text: "param" });
            const typeNode = createMockNode({ type: "type", text: "str" });
            const typedParam = createMockNode({
                type: "typed_parameter",
                text: "param: str",
                namedChildCount: 2,
                namedChildren: [nameNode, typeNode],
                childForFieldName: (name) => {
                    if (name === "name")
                        return nameNode;
                    if (name === "type")
                        return typeNode;
                    return null;
                },
                namedChild: (i) => [nameNode, typeNode][i] || null,
            });
            const node = createMockNode({
                namedChildCount: 1,
                namedChildren: [typedParam],
                namedChild: () => typedParam,
            });
            const result = extractParams(node);
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                name: "param",
                type: "str",
                default_value: null,
                is_args: false,
                is_kwargs: false,
            });
        });
        it("should handle typed_parameter with fallback to namedChild", () => {
            const nameNode = createMockNode({ text: "myvar" });
            const typeNode = createMockNode({ text: "int" });
            const typedParam = createMockNode({
                type: "typed_parameter",
                namedChildCount: 2,
                namedChildren: [nameNode, typeNode],
                childForFieldName: () => null,
                namedChild: (i) => [nameNode, typeNode][i] || null,
            });
            const node = createMockNode({
                namedChildCount: 1,
                namedChildren: [typedParam],
                namedChild: () => typedParam,
            });
            const result = extractParams(node);
            expect(result[0].name).toBe("myvar");
            expect(result[0].type).toBe("int");
        });
    });
    describe("default parameters", () => {
        it("should extract default_parameter with value", () => {
            const nameNode = createMockNode({ text: "param" });
            const valueNode = createMockNode({ text: "42" });
            const defaultParam = createMockNode({
                type: "default_parameter",
                text: "param=42",
                namedChildCount: 2,
                namedChildren: [nameNode, valueNode],
                childForFieldName: (name) => {
                    if (name === "name")
                        return nameNode;
                    if (name === "value")
                        return valueNode;
                    return null;
                },
            });
            const node = createMockNode({
                namedChildCount: 1,
                namedChildren: [defaultParam],
                namedChild: () => defaultParam,
            });
            const result = extractParams(node);
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                name: "param",
                type: null,
                default_value: "42",
                is_args: false,
                is_kwargs: false,
            });
        });
        it("should extract typed_default_parameter with type and default", () => {
            const nameNode = createMockNode({ text: "count" });
            const typeNode = createMockNode({ text: "int" });
            const valueNode = createMockNode({ text: "0" });
            const typedDefaultParam = createMockNode({
                type: "typed_default_parameter",
                text: "count: int = 0",
                namedChildCount: 3,
                namedChildren: [nameNode, typeNode, valueNode],
                childForFieldName: (name) => {
                    if (name === "name")
                        return nameNode;
                    if (name === "type")
                        return typeNode;
                    if (name === "value")
                        return valueNode;
                    return null;
                },
            });
            const node = createMockNode({
                namedChildCount: 1,
                namedChildren: [typedDefaultParam],
                namedChild: () => typedDefaultParam,
            });
            const result = extractParams(node);
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                name: "count",
                type: "int",
                default_value: "0",
                is_args: false,
                is_kwargs: false,
            });
        });
    });
    describe("variadic parameters", () => {
        it("should extract *args (list_splat_pattern)", () => {
            const argsNode = createMockNode({ text: "args" });
            const splatPattern = createMockNode({
                type: "list_splat_pattern",
                text: "*args",
                namedChildCount: 1,
                namedChildren: [argsNode],
                namedChild: (i) => (i === 0 ? argsNode : null),
            });
            const node = createMockNode({
                namedChildCount: 1,
                namedChildren: [splatPattern],
                namedChild: () => splatPattern,
            });
            const result = extractParams(node);
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                name: "args",
                type: null,
                default_value: null,
                is_args: true,
                is_kwargs: false,
            });
        });
        it("should extract **kwargs (dictionary_splat_pattern)", () => {
            const kwargsNode = createMockNode({ text: "kwargs" });
            const dictSplat = createMockNode({
                type: "dictionary_splat_pattern",
                text: "**kwargs",
                namedChildCount: 1,
                namedChildren: [kwargsNode],
                namedChild: (i) => (i === 0 ? kwargsNode : null),
            });
            const node = createMockNode({
                namedChildCount: 1,
                namedChildren: [dictSplat],
                namedChild: () => dictSplat,
            });
            const result = extractParams(node);
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                name: "kwargs",
                type: null,
                default_value: null,
                is_args: false,
                is_kwargs: true,
            });
        });
        it("should extract mixed parameters", () => {
            const paramIdent = createMockNode({ type: "identifier", text: "x" });
            const argsNode = createMockNode({ text: "args" });
            const splatPattern = createMockNode({
                type: "list_splat_pattern",
                text: "*args",
                namedChildCount: 1,
                namedChildren: [argsNode],
                namedChild: (i) => (i === 0 ? argsNode : null),
            });
            const kwargsNode = createMockNode({ text: "kwargs" });
            const dictSplat = createMockNode({
                type: "dictionary_splat_pattern",
                text: "**kwargs",
                namedChildCount: 1,
                namedChildren: [kwargsNode],
                namedChild: (i) => (i === 0 ? kwargsNode : null),
            });
            const node = createMockNode({
                namedChildCount: 3,
                namedChildren: [paramIdent, splatPattern, dictSplat],
                namedChild: (i) => [paramIdent, splatPattern, dictSplat][i] || null,
            });
            const result = extractParams(node);
            expect(result).toHaveLength(3);
            expect(result[0].name).toBe("x");
            expect(result[1].is_args).toBe(true);
            expect(result[2].is_kwargs).toBe(true);
        });
    });
    describe("edge cases", () => {
        it("should handle missing child names gracefully", () => {
            const typedParam = createMockNode({
                type: "typed_parameter",
                childForFieldName: () => null,
                namedChild: () => null,
            });
            const node = createMockNode({
                namedChildCount: 1,
                namedChildren: [typedParam],
                namedChild: () => typedParam,
            });
            const result = extractParams(node);
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe("");
        });
        it("should skip unknown parameter types", () => {
            const unknownNode = createMockNode({ type: "unknown_type" });
            const node = createMockNode({
                namedChildCount: 1,
                namedChildren: [unknownNode],
                namedChild: () => unknownNode,
            });
            const result = extractParams(node);
            expect(result).toEqual([]);
        });
    });
});
describe("extractFunction", () => {
    it("should extract basic function signature", () => {
        const nameNode = createMockNode({ text: "my_function" });
        const paramsNode = createMockNode({ namedChildCount: 0 });
        const bodyNode = createMockNode({ namedChildCount: 0 });
        const funcNode = createMockNode({
            type: "function_definition",
            text: "def my_function():\n    pass",
            startPosition: { row: 0, column: 0 },
            endPosition: { row: 1, column: 8 },
            childForFieldName: (name) => {
                if (name === "name")
                    return nameNode;
                if (name === "parameters")
                    return paramsNode;
                if (name === "body")
                    return bodyNode;
                return null;
            },
        });
        const result = extractFunction(funcNode, null);
        expect(result.name).toBe("my_function");
        expect(result.params).toEqual([]);
        expect(result.return_type).toBeNull();
        expect(result.is_method).toBe(false);
        expect(result.class_name).toBeNull();
        expect(result.start_line).toBe(1);
        expect(result.end_line).toBe(2);
    });
    it("should mark function as method when className provided", () => {
        const nameNode = createMockNode({ text: "my_method" });
        const funcNode = createMockNode({
            type: "function_definition",
            childForFieldName: (name) => (name === "name" ? nameNode : null),
        });
        const result = extractFunction(funcNode, "MyClass");
        expect(result.is_method).toBe(true);
        expect(result.class_name).toBe("MyClass");
    });
    it("should detect async functions", () => {
        const nameNode = createMockNode({ text: "async_func" });
        const funcNode = createMockNode({
            type: "function_definition",
            text: "async def async_func():\n    pass",
            childForFieldName: (name) => (name === "name" ? nameNode : null),
        });
        const result = extractFunction(funcNode, null);
        expect(result.is_async).toBe(true);
    });
    it("should extract return type annotation", () => {
        const nameNode = createMockNode({ text: "get_value" });
        const returnTypeNode = createMockNode({ text: "int" });
        const funcNode = createMockNode({
            type: "function_definition",
            childForFieldName: (name) => {
                if (name === "name")
                    return nameNode;
                if (name === "return_type")
                    return returnTypeNode;
                return null;
            },
        });
        const result = extractFunction(funcNode, null);
        expect(result.return_type).toBe("int");
    });
});
describe("extractClass", () => {
    it("should extract basic class definition", () => {
        const nameNode = createMockNode({ text: "MyClass" });
        const bodyNode = createMockNode({ namedChildCount: 0 });
        const classNode = createMockNode({
            type: "class_definition",
            text: "class MyClass:\n    pass",
            startPosition: { row: 0, column: 0 },
            endPosition: { row: 1, column: 8 },
            childForFieldName: (name) => {
                if (name === "name")
                    return nameNode;
                if (name === "body")
                    return bodyNode;
                return null;
            },
        });
        const result = extractClass(classNode);
        expect(result.name).toBe("MyClass");
        expect(result.methods).toEqual([]);
        expect(result.bases).toEqual([]);
        expect(result.start_line).toBe(1);
        expect(result.end_line).toBe(2);
    });
    it("should extract class with base classes", () => {
        const nameNode = createMockNode({ text: "Child" });
        const baseNode1 = createMockNode({ text: "Parent" });
        const baseNode2 = createMockNode({ text: "Mixin" });
        const superclassNode = createMockNode({
            namedChildCount: 2,
            namedChildren: [baseNode1, baseNode2],
            namedChild: (i) => [baseNode1, baseNode2][i] || null,
        });
        const classNode = createMockNode({
            type: "class_definition",
            childForFieldName: (name) => {
                if (name === "name")
                    return nameNode;
                if (name === "superclasses")
                    return superclassNode;
                return null;
            },
        });
        const result = extractClass(classNode);
        expect(result.name).toBe("Child");
        expect(result.bases).toEqual(["Parent", "Mixin"]);
    });
    it("should extract methods from class body", () => {
        const nameNode = createMockNode({ text: "MyClass" });
        const methodNameNode = createMockNode({ text: "my_method" });
        const methodNode = createMockNode({
            type: "function_definition",
            childForFieldName: (name) => (name === "name" ? methodNameNode : null),
            startPosition: { row: 1, column: 0 },
            endPosition: { row: 1, column: 10 },
        });
        const bodyNode = createMockNode({
            namedChildCount: 1,
            namedChildren: [methodNode],
            namedChild: () => methodNode,
        });
        const classNode = createMockNode({
            type: "class_definition",
            childForFieldName: (name) => {
                if (name === "name")
                    return nameNode;
                if (name === "body")
                    return bodyNode;
                return null;
            },
        });
        const result = extractClass(classNode);
        expect(result.name).toBe("MyClass");
        expect(result.methods).toHaveLength(1);
        expect(result.methods[0].name).toBe("my_method");
        expect(result.methods[0].class_name).toBe("MyClass");
    });
});
describe("extractDecorators", () => {
    it("should extract decorators from node", () => {
        const decorator1 = createMockNode({
            type: "decorator",
            text: "@property",
        });
        const decorator2 = createMockNode({
            type: "decorator",
            text: "@staticmethod",
        });
        const node = createMockNode({
            namedChildren: [decorator1, decorator2],
        });
        const result = extractDecorators(node);
        expect(result).toEqual(["property", "staticmethod"]);
    });
    it("should return empty array when no decorators", () => {
        const node = createMockNode({ namedChildren: [] });
        const result = extractDecorators(node);
        expect(result).toEqual([]);
    });
    it("should skip non-decorator nodes", () => {
        const decorator1 = createMockNode({
            type: "decorator",
            text: "@decorator1",
        });
        const otherNode = createMockNode({ type: "other_type" });
        const node = createMockNode({
            namedChildren: [decorator1, otherNode],
        });
        const result = extractDecorators(node);
        expect(result).toHaveLength(1);
        expect(result[0]).toBe("decorator1");
    });
    it("should handle decorator with arguments", () => {
        const decoratorNode = createMockNode({
            type: "decorator",
            text: "@retry(max_attempts=3)",
        });
        const node = createMockNode({
            namedChildren: [decoratorNode],
        });
        const result = extractDecorators(node);
        expect(result).toEqual(["retry(max_attempts=3)"]);
    });
});
describe("extractDocstring", () => {
    it("should extract docstring from first statement", () => {
        const stringNode = createMockNode({
            type: "string",
            text: '"""This is a docstring"""',
        });
        const exprStmt = createMockNode({
            type: "expression_statement",
            namedChildCount: 1,
            namedChildren: [stringNode],
            namedChild: () => stringNode,
        });
        const bodyNode = createMockNode({
            namedChildCount: 1,
            namedChildren: [exprStmt],
            namedChild: () => exprStmt,
        });
        const result = extractDocstring(bodyNode);
        expect(result).toBe("This is a docstring");
    });
    it("should return null for empty body", () => {
        const bodyNode = createMockNode({ namedChildCount: 0 });
        const result = extractDocstring(bodyNode);
        expect(result).toBeNull();
    });
    it("should return null when body is null", () => {
        const result = extractDocstring(null);
        expect(result).toBeNull();
    });
    it("should handle single quote docstrings", () => {
        const stringNode = createMockNode({
            type: "string",
            text: "'Single quote docstring'",
        });
        const exprStmt = createMockNode({
            type: "expression_statement",
            namedChildCount: 1,
            namedChildren: [stringNode],
            namedChild: () => stringNode,
        });
        const bodyNode = createMockNode({
            namedChildCount: 1,
            namedChildren: [exprStmt],
            namedChild: () => exprStmt,
        });
        const result = extractDocstring(bodyNode);
        expect(result).toBe("Single quote docstring");
    });
});
describe("extractImport", () => {
    it("should extract simple import statement", () => {
        const nameNode = createMockNode({
            type: "dotted_name",
            text: "os",
        });
        const node = createMockNode({
            namedChildCount: 1,
            namedChildren: [nameNode],
            namedChild: () => nameNode,
            startPosition: { row: 0, column: 0 },
        });
        const result = extractImport(node);
        expect(result).toEqual({
            module: "os",
            names: ["os"],
            is_from: false,
            line: 1,
        });
    });
    it("should extract multiple imports", () => {
        const name1 = createMockNode({ type: "dotted_name", text: "os" });
        const name2 = createMockNode({ type: "dotted_name", text: "sys" });
        const node = createMockNode({
            namedChildCount: 2,
            namedChildren: [name1, name2],
            namedChild: (i) => [name1, name2][i] || null,
            startPosition: { row: 5, column: 0 },
        });
        const result = extractImport(node);
        expect(result.names).toEqual(["os", "sys"]);
        expect(result.line).toBe(6);
    });
    it("should handle aliased imports", () => {
        const aliasNode = createMockNode({
            type: "aliased_import",
            text: "numpy as np",
        });
        const node = createMockNode({
            namedChildCount: 1,
            namedChildren: [aliasNode],
            namedChild: () => aliasNode,
            startPosition: { row: 0, column: 0 },
        });
        const result = extractImport(node);
        expect(result.names).toContain("numpy as np");
        expect(result.is_from).toBe(false);
    });
});
describe("extractFromImport", () => {
    it("should extract from import statement", () => {
        const moduleNode = createMockNode({ text: "os.path" });
        const nameNode = createMockNode({
            type: "dotted_name",
            text: "join",
        });
        const node = createMockNode({
            namedChildCount: 1,
            namedChildren: [nameNode],
            childForFieldName: (name) => name === "module_name" ? moduleNode : null,
            namedChild: (i) => (i === 0 ? nameNode : null),
            startPosition: { row: 2, column: 0 },
        });
        const result = extractFromImport(node);
        expect(result).toEqual({
            module: "os.path",
            names: ["join"],
            is_from: true,
            line: 3,
        });
    });
    it("should extract multiple names from module", () => {
        const moduleNode = createMockNode({ text: "collections" });
        const name1 = createMockNode({
            type: "dotted_name",
            text: "defaultdict",
        });
        const name2 = createMockNode({
            type: "dotted_name",
            text: "Counter",
        });
        const node = createMockNode({
            namedChildCount: 2,
            namedChildren: [name1, name2],
            childForFieldName: (name) => name === "module_name" ? moduleNode : null,
            namedChild: (i) => [name1, name2][i] || null,
            startPosition: { row: 0, column: 0 },
        });
        const result = extractFromImport(node);
        expect(result.module).toBe("collections");
        expect(result.names).toEqual(["defaultdict", "Counter"]);
        expect(result.is_from).toBe(true);
    });
    it("should handle from import with aliases", () => {
        const moduleNode = createMockNode({ text: "numpy" });
        const aliasNode = createMockNode({
            type: "aliased_import",
            text: "array as arr",
        });
        const node = createMockNode({
            namedChildCount: 1,
            namedChildren: [aliasNode],
            childForFieldName: (name) => name === "module_name" ? moduleNode : null,
            namedChild: (i) => (i === 0 ? aliasNode : null),
            startPosition: { row: 0, column: 0 },
        });
        const result = extractFromImport(node);
        expect(result.module).toBe("numpy");
        expect(result.names).toContain("array as arr");
        expect(result.is_from).toBe(true);
    });
});
describe("handleDecorated", () => {
    it("should handle decorated function", () => {
        const decoratorNode = createMockNode({
            type: "decorator",
            text: "@property",
        });
        const funcNameNode = createMockNode({ text: "my_prop" });
        const funcNode = createMockNode({
            type: "function_definition",
            childForFieldName: (name) => (name === "name" ? funcNameNode : null),
        });
        const decoratedNode = createMockNode({
            type: "decorated_definition",
            namedChildren: [decoratorNode, funcNode],
        });
        const functions = [];
        const classes = [];
        handleDecorated(decoratedNode, functions, classes, null);
        expect(functions).toHaveLength(1);
        expect(functions[0].name).toBe("my_prop");
        expect(functions[0].decorators).toContain("property");
    });
    it("should handle decorated class", () => {
        const decoratorNode = createMockNode({
            type: "decorator",
            text: "@dataclass",
        });
        const classNameNode = createMockNode({ text: "MyDataClass" });
        const classNode = createMockNode({
            type: "class_definition",
            childForFieldName: (name) => (name === "name" ? classNameNode : null),
        });
        const decoratedNode = createMockNode({
            type: "decorated_definition",
            namedChildren: [decoratorNode, classNode],
        });
        const functions = [];
        const classes = [];
        handleDecorated(decoratedNode, functions, classes, null);
        expect(classes).toHaveLength(1);
        expect(classes[0].name).toBe("MyDataClass");
        expect(classes[0].decorators).toContain("dataclass");
    });
    it("should not add to arrays if no inner definition", () => {
        const decoratorNode = createMockNode({
            type: "decorator",
            text: "@decorator",
        });
        const decoratedNode = createMockNode({
            type: "decorated_definition",
            namedChildren: [decoratorNode],
        });
        const functions = [];
        const classes = [];
        handleDecorated(decoratedNode, functions, classes, null);
        expect(functions).toHaveLength(0);
        expect(classes).toHaveLength(0);
    });
});
describe("parser functions requiring tree-sitter", () => {
    it.skip("should find wasm file", () => {
        expect(true).toBe(true);
    });
    it.skip("should parse source code", () => {
        expect(true).toBe(true);
    });
    it.skip("should initialize parser", () => {
        expect(true).toBe(true);
    });
    it.skip("should parse file", () => {
        expect(true).toBe(true);
    });
});
//# sourceMappingURL=parser.test.js.map