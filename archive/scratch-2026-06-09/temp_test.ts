import { describe, it, expect } from "vitest";
import { renderOnboardHtml } from "../../packages/render/src/onboard-renderer.js";

describe("renderOnboardHtml", () => {
  it("should execute without throwing", () => {
    const result = renderOnboardHtml("test-text");
    expect(result).toBeDefined();
  });

  it("should return correct type (string)", () => {
    const result = renderOnboardHtml("test-text");
    expect(typeof result).toBe("string");
  });

});