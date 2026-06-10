import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseFileAuto, getSupportedExtensions, initParsers } from "../../packages/ast/src/multi-lang.js";

const mockParseFile = vi.fn();
const mockParseTsFile = vi.fn();
const mockInitParser = vi.fn().mockResolvedValue(undefined);
const mockInitTsParser = vi.fn().mockResolvedValue(undefined);

vi.mock("../../packages/ast/src/parser.js", () => ({
  initParser: (...args: unknown[]) => mockInitParser(...args),
  parseFile: (...args: unknown[]) => mockParseFile(...args),
}));

vi.mock("../../packages/ast/src/ts-parser.js", () => ({
  initTsParser: (...args: unknown[]) => mockInitTsParser(...args),
  parseTsFile: (...args: unknown[]) => mockParseTsFile(...args),
}));

const pythonResult = {
  filePath: "src/module.py",
  functions: [
    { name: "hello", startLine: 1, endLine: 3, params: [], identity: "abc12345abc12345" },
  ],
  classes: [],
};

const tsResult = {
  filePath: "src/index.ts",
  functions: [
    { name: "greet", startLine: 1, endLine: 5, params: [{ name: "name", type: "string" }], identity: "def45678def45678" },
  ],
  classes: [],
};

describe("getSupportedExtensions", () => {
  it("should return all supported extensions", () => {
    const extensions = getSupportedExtensions();
    expect(extensions).toContain(".py");
    expect(extensions).toContain(".pyi");
    expect(extensions).toContain(".ts");
    expect(extensions).toContain(".tsx");
    expect(extensions).toContain(".mts");
    expect(extensions).toContain(".cts");
  });

  it("should return exactly 6 extensions", () => {
    const extensions = getSupportedExtensions();
    expect(extensions).toHaveLength(6);
  });

  it("should return strings starting with a dot", () => {
    const extensions = getSupportedExtensions();
    for (const ext of extensions) {
      expect(ext).toMatch(/^\.\w+$/);
    }
  });
});

describe("initParsers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize both parsers without throwing", async () => {
    await expect(initParsers()).resolves.toBeUndefined();
  });

  it("should call both initParser and initTsParser", async () => {
    await initParsers();
    expect(mockInitParser).toHaveBeenCalledOnce();
    expect(mockInitTsParser).toHaveBeenCalledOnce();
  });
});

describe("parseFileAuto", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParseFile.mockReturnValue(pythonResult);
    mockParseTsFile.mockReturnValue(tsResult);
  });

  it("should parse a .py file using the Python parser", async () => {
    const result = await parseFileAuto("src/module.py");
    expect(result).toEqual(pythonResult);
    expect(mockInitParser).toHaveBeenCalledOnce();
    expect(mockParseFile).toHaveBeenCalledWith("src/module.py");
  });

  it("should parse a .pyi file using the Python parser", async () => {
    const result = await parseFileAuto("stubs/module.pyi");
    expect(result).toBeDefined();
    expect(mockParseFile).toHaveBeenCalledWith("stubs/module.pyi");
  });

  it("should parse a .ts file using the TypeScript parser", async () => {
    const result = await parseFileAuto("src/index.ts");
    expect(result).toEqual(tsResult);
    expect(mockInitTsParser).toHaveBeenCalledOnce();
    expect(mockParseTsFile).toHaveBeenCalledWith("src/index.ts");
  });

  it("should parse a .tsx file using the TypeScript parser", async () => {
    const result = await parseFileAuto("components/App.tsx");
    expect(result).toBeDefined();
    expect(mockParseTsFile).toHaveBeenCalledWith("components/App.tsx");
  });

  it("should parse a .mts file using the TypeScript parser", async () => {
    const result = await parseFileAuto("lib/util.mts");
    expect(result).toBeDefined();
    expect(mockParseTsFile).toHaveBeenCalledWith("lib/util.mts");
  });

  it("should parse a .cts file using the TypeScript parser", async () => {
    const result = await parseFileAuto("lib/config.cts");
    expect(result).toBeDefined();
    expect(mockParseTsFile).toHaveBeenCalledWith("lib/config.cts");
  });

  it("should handle uppercase extensions case-insensitively", async () => {
    const result = await parseFileAuto("script.PY");
    expect(result).toBeDefined();
    expect(mockParseFile).toHaveBeenCalledWith("script.PY");
  });

  it("should handle mixed-case extensions", async () => {
    const result = await parseFileAuto("component.Tsx");
    expect(result).toBeDefined();
    expect(mockParseTsFile).toHaveBeenCalledWith("component.Tsx");
  });

  it("should throw for unsupported file extensions", async () => {
    await expect(parseFileAuto("readme.md")).rejects.toThrow("Unsupported file extension: .md");
  });

  it("should throw for .js files", async () => {
    await expect(parseFileAuto("index.js")).rejects.toThrow("Unsupported file extension: .js");
  });

  it("should throw for files with no extension", async () => {
    await expect(parseFileAuto("Makefile")).rejects.toThrow("Unsupported file extension:");
  });

  it("should include supported extensions in the error message", async () => {
    await expect(parseFileAuto("data.json")).rejects.toThrow(".py");
  });

  it("should throw when given null input", async () => {
    await expect(parseFileAuto(null as any)).rejects.toThrow();
  });

  it("should throw when given undefined input", async () => {
    await expect(parseFileAuto(undefined as any)).rejects.toThrow();
  });

  it("should not call TypeScript parser for Python files", async () => {
    await parseFileAuto("main.py");
    expect(mockInitTsParser).not.toHaveBeenCalled();
    expect(mockParseTsFile).not.toHaveBeenCalled();
  });

  it("should not call Python parser for TypeScript files", async () => {
    await parseFileAuto("main.ts");
    expect(mockInitParser).not.toHaveBeenCalled();
    expect(mockParseFile).not.toHaveBeenCalled();
  });

  it("should handle paths with directories", async () => {
    const result = await parseFileAuto("deep/nested/path/module.py");
    expect(result).toBeDefined();
    expect(mockParseFile).toHaveBeenCalledWith("deep/nested/path/module.py");
  });

  it("should handle paths with dots in directory names", async () => {
    const result = await parseFileAuto("src/v2.0/module.ts");
    expect(result).toBeDefined();
    expect(mockParseTsFile).toHaveBeenCalledWith("src/v2.0/module.ts");
  });
});
