import { describe, it, expect } from "vitest";
import { inferMockValue } from "../../packages/core/src/test-gen/ts-generator.js";

describe("inferMockValue", () => {
  it("should execute without throwing", () => {
    const result = inferMockValue("test-name", undefined /* TODO: provide type */);
    expect(result).toBeDefined();
  });

  it("should return correct type (string)", () => {
    const result = inferMockValue("test-name", undefined /* TODO: provide type */);
    expect(typeof result).toBe("string");
  });

  it("should throw on invalid input", () => {
    expect(() => inferMockValue(null as any, undefined as any)).toThrow();
  });

});