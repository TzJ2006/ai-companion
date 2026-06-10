import { describe, it, expect } from "vitest";
import { getTestFileName } from "../../scripts/collect-report-data.js";

describe("getTestFileName", () => {
  it("should execute without throwing", () => {
    const result = getTestFileName("test-filePath", "test-fnName", "test-name");
    expect(result).toBeDefined();
  });

  it("should return correct type (string)", () => {
    const result = getTestFileName("test-filePath", "test-fnName", "test-name");
    expect(typeof result).toBe("string");
  });

  it("should throw on invalid input", () => {
    expect(() => getTestFileName(null as any, null as any, undefined as any)).toThrow();
  });

  it("should be idempotent (same input → same output)", () => {
    const r1 = getTestFileName("test-filePath", "test-fnName", "test-name");
    const r2 = getTestFileName("test-filePath", "test-fnName", "test-name");
    expect(r1).toEqual(r2);
  });

});