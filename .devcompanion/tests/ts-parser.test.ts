import { describe, it, expect } from "vitest";

describe("ts-parser exports", () => {
  it("should export parseTsFile as function", async () => {
    const mod = await import("../../packages/ast/src/ts-parser.js");
    expect(typeof mod.parseTsFile).toBe("function");
  });

  it("should export initTsParser as function", async () => {
    const mod = await import("../../packages/ast/src/ts-parser.js");
    expect(typeof mod.initTsParser).toBe("function");
  });

  it("should export parseTsSource as function", async () => {
    const mod = await import("../../packages/ast/src/ts-parser.js");
    expect(typeof mod.parseTsSource).toBe("function");
  });

  it("should export internal functions", async () => {
    const mod = await import("../../packages/ast/src/ts-parser.js");
    expect(typeof mod.extractTsFunction).toBe("function");
    expect(typeof mod.extractTsClass).toBe("function");
    expect(typeof mod.extractTsMethod).toBe("function");
    expect(typeof mod.extractTsParams).toBe("function");
    expect(typeof mod.extractArrowFunctions).toBe("function");
    expect(typeof mod.extractTsDecorators).toBe("function");
    expect(typeof mod.extractJsDoc).toBe("function");
    expect(typeof mod.extractTsImport).toBe("function");
    expect(typeof mod.handleExportStatement).toBe("function");
    expect(typeof mod.cleanTypeAnnotation).toBe("function");
  });
});
