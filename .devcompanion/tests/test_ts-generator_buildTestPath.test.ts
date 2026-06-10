import { describe, it, expect } from "vitest";
import { buildTestPath } from "../../packages/core/src/test-gen/ts-generator.js";

describe("buildTestPath", () => {
  it("should execute without throwing", () => {
    const result = buildTestPath("test-sourceFile", "test-name", "test-name", {});
    expect(result).toBeDefined();
  });

  it("should return correct type (string)", () => {
    const result = buildTestPath("test-sourceFile", "test-name", "test-name", {});
    expect(typeof result).toBe("string");
  });

  it("should throw on invalid input", () => {
    expect(() => buildTestPath(null as any, null as any, undefined as any, undefined as any)).toThrow();
  });

});