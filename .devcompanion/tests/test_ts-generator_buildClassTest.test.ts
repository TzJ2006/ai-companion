import { describe, it, expect } from "vitest";
import { buildClassTest } from "../../packages/core/src/test-gen/ts-generator.js";

describe("buildClassTest", () => {
  it("should execute without throwing", () => {
    const result = buildClassTest("test-className", [], "test-sourceFile", {});
    expect(result).toBeDefined();
  });

  it("should return correct type (string)", () => {
    const result = buildClassTest("test-className", [], "test-sourceFile", {});
    expect(typeof result).toBe("string");
  });

});