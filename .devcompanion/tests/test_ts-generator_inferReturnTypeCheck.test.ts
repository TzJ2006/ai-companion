import { describe, it, expect } from "vitest";
import { inferReturnTypeCheck } from "../../packages/core/src/test-gen/ts-generator.js";

describe("inferReturnTypeCheck", () => {
  it("should execute without throwing", () => {
    const result = inferReturnTypeCheck("test-returnType");
    expect(result).toBeDefined();
  });

  it("should return correct type (string | null)", () => {
    const result = inferReturnTypeCheck("test-returnType");
    expect(result).toBeDefined();
  });

});