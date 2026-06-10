import { describe, it, expect } from "vitest";
import { findWasmPath } from "../../packages/ast/src/parser.js";

describe("findWasmPath", () => {
  it("should execute without throwing", () => {
    const result = findWasmPath();
    expect(result).toBeDefined();
  });

  it("should return correct type (string)", () => {
    const result = findWasmPath();
    expect(typeof result).toBe("string");
  });

});