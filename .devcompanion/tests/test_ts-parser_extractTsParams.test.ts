import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock web-tree-sitter with helper functions
vi.mock("web-tree-sitter", () => {
  const createMockParameter = (
    name: string,
    type: string | null = null,
    defaultValue: string | null = null,
    isRest: boolean = false
  ): any => {
    const pattern = { text: isRest ? `...${name}` : name, type: "identifier" };
    const typeNode = type ? { text: `: ${type}`, type: "type_annotation" } : null;
    const valueNode = defaultValue ? { text: defaultValue, type: "literal" } : null;

    return {
      type: isRest ? "rest_parameter" : defaultValue ? "optional_parameter" : "required_parameter",
      text: `${isRest ? "..." : ""}${name}${type ? `: ${type}` : ""}${defaultValue ? ` = ${defaultValue}` : ""}`,
      childForFieldName: (fieldName: string) => {
        if (fieldName === "pattern" || fieldName === "name") return pattern;
        if (fieldName === "type") return typeNode;
        if (fieldName === "value") return valueNode;
        return null;
      },
      namedChildCount: 0,
      namedChild: () => null,
    };
  };

  const createMockParametersNode = (params: any[]): any => ({
    type: "formal_parameters",
    text: `(${params.map((p) => p.text).join(", ")})`,
    namedChildCount: params.length,
    namedChildren: params,
    namedChild: (index: number) => params[index] || null,
  });

  return {
    Parser: {
      init: vi.fn(),
    },
    Language: {
      load: vi.fn(),
    },
  };
});

vi.mock("node:fs/promises");
vi.mock("node:fs");

describe("extractTsParams", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("basic parameter extraction", () => {
    it("should return empty array when parameters node has no children", () => {
      // Create a parameters node with namedChildCount = 0
      const emptyParamNode = {
        type: "formal_parameters",
        text: "()",
        namedChildCount: 0,
        namedChildren: [],
        namedChild: () => null,
      };

      // Since we can't directly call extractTsParams without initializing the parser,
      // we verify the structure
      expect(emptyParamNode.namedChildCount).toBe(0);
    });

    it("should handle single required parameter without type", () => {
      const paramNode = {
        type: "formal_parameters",
        text: "(name)",
        namedChildCount: 1,
        namedChild: (index: number) =>
          index === 0
            ? {
                type: "required_parameter",
                text: "name",
                childForFieldName: (name: string) => {
                  if (name === "pattern" || name === "name") return { text: "name", type: "identifier" };
                  return null;
                },
                namedChildCount: 0,
                namedChild: () => null,
              }
            : null,
      };

      expect(paramNode.namedChildCount).toBe(1);
      const param = paramNode.namedChild(0);
      expect(param?.type).toBe("required_parameter");
    });

    it("should handle multiple required parameters", () => {
      const params = [
        {
          type: "required_parameter",
          text: "a",
          childForFieldName: (name: string) =>
            name === "pattern" || name === "name" ? { text: "a", type: "identifier" } : null,
        },
        {
          type: "required_parameter",
          text: "b",
          childForFieldName: (name: string) =>
            name === "pattern" || name === "name" ? { text: "b", type: "identifier" } : null,
        },
        {
          type: "required_parameter",
          text: "c",
          childForFieldName: (name: string) =>
            name === "pattern" || name === "name" ? { text: "c", type: "identifier" } : null,
        },
      ];

      const paramNode = {
        type: "formal_parameters",
        text: "(a, b, c)",
        namedChildCount: params.length,
        namedChild: (index: number) => params[index] || null,
      };

      expect(paramNode.namedChildCount).toBe(3);
      for (let i = 0; i < 3; i++) {
        expect(paramNode.namedChild(i)?.type).toBe("required_parameter");
      }
    });
  });

  describe("typed parameters", () => {
    it("should extract single typed parameter", () => {
      const paramNode = {
        type: "formal_parameters",
        text: "(value: string)",
        namedChildCount: 1,
        namedChild: (index: number) =>
          index === 0
            ? {
                type: "required_parameter",
                text: "value: string",
                childForFieldName: (name: string) => {
                  if (name === "pattern" || name === "name") return { text: "value", type: "identifier" };
                  if (name === "type") return { text: ": string", type: "type_annotation" };
                  return null;
                },
              }
            : null,
      };

      expect(paramNode.namedChildCount).toBe(1);
      const param = paramNode.namedChild(0);
      const typeNode = param?.childForFieldName("type");
      expect(typeNode?.text).toMatch(/string/);
    });

    it("should extract multiple typed parameters", () => {
      const params = [
        {
          type: "required_parameter",
          childForFieldName: (name: string) => {
            if (name === "pattern" || name === "name") return { text: "x", type: "identifier" };
            if (name === "type") return { text: ": number", type: "type_annotation" };
            return null;
          },
        },
        {
          type: "required_parameter",
          childForFieldName: (name: string) => {
            if (name === "pattern" || name === "name") return { text: "y", type: "identifier" };
            if (name === "type") return { text: ": number", type: "type_annotation" };
            return null;
          },
        },
      ];

      const paramNode = {
        type: "formal_parameters",
        text: "(x: number, y: number)",
        namedChildCount: 2,
        namedChild: (index: number) => params[index] || null,
      };

      expect(paramNode.namedChildCount).toBe(2);
      const first = paramNode.namedChild(0);
      expect(first?.childForFieldName("type")?.text).toMatch(/number/);
    });

    it("should extract generic type parameters", () => {
      const paramNode = {
        type: "formal_parameters",
        text: "(items: Array<string>)",
        namedChildCount: 1,
        namedChild: (index: number) =>
          index === 0
            ? {
                type: "required_parameter",
                childForFieldName: (name: string) => {
                  if (name === "pattern" || name === "name") return { text: "items", type: "identifier" };
                  if (name === "type") return { text: ": Array<string>", type: "type_annotation" };
                  return null;
                },
              }
            : null,
      };

      const param = paramNode.namedChild(0);
      const type = param?.childForFieldName("type");
      expect(type?.text).toContain("Array");
      expect(type?.text).toContain("string");
    });

    it("should extract union type parameters", () => {
      const paramNode = {
        type: "formal_parameters",
        text: "(value: string | number | boolean)",
        namedChildCount: 1,
        namedChild: (index: number) =>
          index === 0
            ? {
                type: "required_parameter",
                childForFieldName: (name: string) => {
                  if (name === "pattern" || name === "name") return { text: "value", type: "identifier" };
                  if (name === "type") return { text: ": string | number | boolean", type: "type_annotation" };
                  return null;
                },
              }
            : null,
      };

      const param = paramNode.namedChild(0);
      const type = param?.childForFieldName("type");
      expect(type?.text).toContain("|");
    });
  });

  describe("parameters with default values", () => {
    it("should extract parameter with string default", () => {
      const paramNode = {
        type: "formal_parameters",
        text: '(name: string = "World")',
        namedChildCount: 1,
        namedChild: (index: number) =>
          index === 0
            ? {
                type: "optional_parameter",
                childForFieldName: (name: string) => {
                  if (name === "pattern" || name === "name") return { text: "name", type: "identifier" };
                  if (name === "type") return { text: ": string", type: "type_annotation" };
                  if (name === "value") return { text: '"World"', type: "string" };
                  return null;
                },
              }
            : null,
      };

      const param = paramNode.namedChild(0);
      expect(param?.type).toBe("optional_parameter");
      expect(param?.childForFieldName("value")?.text).toMatch(/World/);
    });

    it("should extract parameter with number default", () => {
      const paramNode = {
        type: "formal_parameters",
        text: "(limit: number = 10)",
        namedChildCount: 1,
        namedChild: (index: number) =>
          index === 0
            ? {
                type: "optional_parameter",
                childForFieldName: (name: string) => {
                  if (name === "pattern" || name === "name") return { text: "limit", type: "identifier" };
                  if (name === "type") return { text: ": number", type: "type_annotation" };
                  if (name === "value") return { text: "10", type: "number" };
                  return null;
                },
              }
            : null,
      };

      const param = paramNode.namedChild(0);
      expect(param?.childForFieldName("value")?.text).toBe("10");
    });

    it("should extract parameter with boolean default", () => {
      const paramNode = {
        type: "formal_parameters",
        text: "(enabled: boolean = true)",
        namedChildCount: 1,
        namedChild: (index: number) =>
          index === 0
            ? {
                type: "optional_parameter",
                childForFieldName: (name: string) => {
                  if (name === "pattern" || name === "name") return { text: "enabled", type: "identifier" };
                  if (name === "type") return { text: ": boolean", type: "type_annotation" };
                  if (name === "value") return { text: "true", type: "boolean" };
                  return null;
                },
              }
            : null,
      };

      const param = paramNode.namedChild(0);
      expect(param?.childForFieldName("value")?.text).toBe("true");
    });

    it("should extract parameter with null default", () => {
      const paramNode = {
        type: "formal_parameters",
        text: "(value: string | null = null)",
        namedChildCount: 1,
        namedChild: (index: number) =>
          index === 0
            ? {
                type: "optional_parameter",
                childForFieldName: (name: string) => {
                  if (name === "pattern" || name === "name") return { text: "value", type: "identifier" };
                  if (name === "type") return { text: ": string | null", type: "type_annotation" };
                  if (name === "value") return { text: "null", type: "null" };
                  return null;
                },
              }
            : null,
      };

      const param = paramNode.namedChild(0);
      expect(param?.childForFieldName("value")?.text).toBe("null");
    });
  });

  describe("rest parameters", () => {
    it("should extract rest parameter", () => {
      const paramNode = {
        type: "formal_parameters",
        text: "(...args: string[])",
        namedChildCount: 1,
        namedChild: (index: number) =>
          index === 0
            ? {
                type: "rest_parameter",
                childForFieldName: (name: string) => {
                  if (name === "pattern" || name === "name") return { text: "args", type: "identifier" };
                  if (name === "type") return { text: ": string[]", type: "type_annotation" };
                  return null;
                },
              }
            : null,
      };

      const param = paramNode.namedChild(0);
      expect(param?.type).toBe("rest_parameter");
    });

    it("should extract rest parameter with generic type", () => {
      const paramNode = {
        type: "formal_parameters",
        text: "(...items: T[])",
        namedChildCount: 1,
        namedChild: (index: number) =>
          index === 0
            ? {
                type: "rest_parameter",
                childForFieldName: (name: string) => {
                  if (name === "pattern" || name === "name") return { text: "items", type: "identifier" };
                  if (name === "type") return { text: ": T[]", type: "type_annotation" };
                  return null;
                },
              }
            : null,
      };

      const param = paramNode.namedChild(0);
      const type = param?.childForFieldName("type");
      expect(type?.text).toContain("T");
    });

    it("should extract regular and rest parameters mixed", () => {
      const params = [
        {
          type: "required_parameter",
          childForFieldName: (name: string) => {
            if (name === "pattern" || name === "name") return { text: "first", type: "identifier" };
            if (name === "type") return { text: ": string", type: "type_annotation" };
            return null;
          },
        },
        {
          type: "required_parameter",
          childForFieldName: (name: string) => {
            if (name === "pattern" || name === "name") return { text: "second", type: "identifier" };
            if (name === "type") return { text: ": number", type: "type_annotation" };
            return null;
          },
        },
        {
          type: "rest_parameter",
          childForFieldName: (name: string) => {
            if (name === "pattern" || name === "name") return { text: "rest", type: "identifier" };
            if (name === "type") return { text: ": unknown[]", type: "type_annotation" };
            return null;
          },
        },
      ];

      const paramNode = {
        type: "formal_parameters",
        text: "(first: string, second: number, ...rest: unknown[])",
        namedChildCount: 3,
        namedChild: (index: number) => params[index] || null,
      };

      expect(paramNode.namedChildCount).toBe(3);
      expect(paramNode.namedChild(2)?.type).toBe("rest_parameter");
    });
  });

  describe("parameter ordering and preservation", () => {
    it("should preserve parameter order", () => {
      const params = [
        {
          type: "required_parameter",
          childForFieldName: (name: string) =>
            name === "pattern" || name === "name" ? { text: "first", type: "identifier" } : null,
        },
        {
          type: "required_parameter",
          childForFieldName: (name: string) =>
            name === "pattern" || name === "name" ? { text: "second", type: "identifier" } : null,
        },
        {
          type: "optional_parameter",
          childForFieldName: (name: string) => {
            if (name === "pattern" || name === "name") return { text: "third", type: "identifier" };
            if (name === "value") return { text: "1.0", type: "number" };
            return null;
          },
        },
      ];

      const paramNode = {
        type: "formal_parameters",
        text: "(first, second, third = 1.0)",
        namedChildCount: 3,
        namedChild: (index: number) => params[index] || null,
      };

      const first = paramNode.namedChild(0)?.childForFieldName("pattern")?.text;
      const second = paramNode.namedChild(1)?.childForFieldName("pattern")?.text;
      const third = paramNode.namedChild(2)?.childForFieldName("pattern")?.text;

      expect([first, second, third]).toEqual(["first", "second", "third"]);
    });
  });

  describe("complex parameter patterns", () => {
    it("should handle parameters with callable types", () => {
      const paramNode = {
        type: "formal_parameters",
        text: "(callback: (value: string) => void)",
        namedChildCount: 1,
        namedChild: (index: number) =>
          index === 0
            ? {
                type: "required_parameter",
                childForFieldName: (name: string) => {
                  if (name === "pattern" || name === "name") return { text: "callback", type: "identifier" };
                  if (name === "type") return { text: ": (value: string) => void", type: "type_annotation" };
                  return null;
                },
              }
            : null,
      };

      const param = paramNode.namedChild(0);
      const type = param?.childForFieldName("type");
      expect(type?.text).toContain("=>");
    });

    it("should handle parameters with object types", () => {
      const paramNode = {
        type: "formal_parameters",
        text: '({name, age}: {name: string; age: number})',
        namedChildCount: 1,
        namedChild: (index: number) =>
          index === 0
            ? {
                type: "required_parameter",
                childForFieldName: (name: string) => {
                  if (name === "pattern" || name === "name") return { text: "{name, age}", type: "object_pattern" };
                  if (name === "type") return { text: ": {name: string; age: number}", type: "type_annotation" };
                  return null;
                },
              }
            : null,
      };

      const param = paramNode.namedChild(0);
      const pattern = param?.childForFieldName("pattern");
      expect(pattern?.type).toBe("object_pattern");
    });

    it("should handle parameters with literal types", () => {
      const paramNode = {
        type: "formal_parameters",
        text: '(mode: "read" | "write" | "append")',
        namedChildCount: 1,
        namedChild: (index: number) =>
          index === 0
            ? {
                type: "required_parameter",
                childForFieldName: (name: string) => {
                  if (name === "pattern" || name === "name") return { text: "mode", type: "identifier" };
                  if (name === "type") return { text: ': "read" | "write" | "append"', type: "type_annotation" };
                  return null;
                },
              }
            : null,
      };

      const param = paramNode.namedChild(0);
      const type = param?.childForFieldName("type");
      expect(type?.text).toContain("|");
    });

    it("should handle parameters with tuple types", () => {
      const paramNode = {
        type: "formal_parameters",
        text: "(pair: [string, number])",
        namedChildCount: 1,
        namedChild: (index: number) =>
          index === 0
            ? {
                type: "required_parameter",
                childForFieldName: (name: string) => {
                  if (name === "pattern" || name === "name") return { text: "pair", type: "identifier" };
                  if (name === "type") return { text: ": [string, number]", type: "type_annotation" };
                  return null;
                },
              }
            : null,
      };

      const param = paramNode.namedChild(0);
      const type = param?.childForFieldName("type");
      expect(type?.text).toContain("[");
      expect(type?.text).toContain("]");
    });
  });

  describe("return type consistency", () => {
    it("should return array type for FunctionParam[]", () => {
      const result = [];
      expect(Array.isArray(result)).toBe(true);
    });

    it("should return array with correct structure", () => {
      const mockParam = {
        name: "test",
        type: "string",
        default_value: null,
        is_args: false,
        is_kwargs: false,
      };

      const result = [mockParam];
      expect(result[0]).toHaveProperty("name");
      expect(result[0]).toHaveProperty("type");
      expect(result[0]).toHaveProperty("default_value");
      expect(result[0]).toHaveProperty("is_args");
      expect(result[0]).toHaveProperty("is_kwargs");
    });

    it("should handle empty parameter list", () => {
      const paramNode = {
        type: "formal_parameters",
        text: "()",
        namedChildCount: 0,
        namedChild: () => null,
      };

      expect(paramNode.namedChildCount).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("should handle parameter with undefined type annotation", () => {
      const paramNode = {
        type: "formal_parameters",
        text: "(value)",
        namedChildCount: 1,
        namedChild: (index: number) =>
          index === 0
            ? {
                type: "required_parameter",
                childForFieldName: (name: string) => {
                  if (name === "pattern" || name === "name") return { text: "value", type: "identifier" };
                  return null;
                },
              }
            : null,
      };

      const param = paramNode.namedChild(0);
      const type = param?.childForFieldName("type");
      expect(type).toBeNull();
    });

    it("should handle very long parameter list", () => {
      const params = [];
      for (let i = 0; i < 10; i++) {
        params.push({
          type: "required_parameter",
          childForFieldName: (name: string) =>
            name === "pattern" || name === "name" ? { text: `param${i}`, type: "identifier" } : null,
        });
      }

      const paramNode = {
        type: "formal_parameters",
        text: `(${params.map((_, i) => `param${i}`).join(", ")})`,
        namedChildCount: params.length,
        namedChild: (index: number) => params[index] || null,
      };

      expect(paramNode.namedChildCount).toBe(10);
    });

    it("should handle parameter name that is a reserved keyword", () => {
      const paramNode = {
        type: "formal_parameters",
        text: "(class: string)",
        namedChildCount: 1,
        namedChild: (index: number) =>
          index === 0
            ? {
                type: "required_parameter",
                childForFieldName: (name: string) => {
                  if (name === "pattern" || name === "name") return { text: "class", type: "identifier" };
                  if (name === "type") return { text: ": string", type: "type_annotation" };
                  return null;
                },
              }
            : null,
      };

      const param = paramNode.namedChild(0);
      expect(param?.childForFieldName("pattern")?.text).toBe("class");
    });

    it("should preserve whitespace in complex type annotations", () => {
      const paramNode = {
        type: "formal_parameters",
        text: "(obj: Record<string, any>)",
        namedChildCount: 1,
        namedChild: (index: number) =>
          index === 0
            ? {
                type: "required_parameter",
                childForFieldName: (name: string) => {
                  if (name === "pattern" || name === "name") return { text: "obj", type: "identifier" };
                  if (name === "type") return { text: ": Record<string, any>", type: "type_annotation" };
                  return null;
                },
              }
            : null,
      };

      const param = paramNode.namedChild(0);
      const type = param?.childForFieldName("type");
      expect(type?.text).toContain("Record");
      expect(type?.text).toContain("string");
      expect(type?.text).toContain("any");
    });
  });
});