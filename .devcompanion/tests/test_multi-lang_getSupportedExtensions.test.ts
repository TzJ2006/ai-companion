import { describe, it, expect } from "vitest";
import { getSupportedExtensions } from "../../packages/ast/src/multi-lang.js";

describe("getSupportedExtensions", () => {
  it("should execute without throwing", () => {
    const result = getSupportedExtensions();
    expect(result).toBeDefined();
  });

  it("should return correct type (string[])", () => {
    const result = getSupportedExtensions();
    expect(Array.isArray(result)).toBe(true);
  });

  it("should be idempotent (same input → same output)", () => {
    const r1 = getSupportedExtensions();
    const r2 = getSupportedExtensions();
    expect(r1).toEqual(r2);
  });

});