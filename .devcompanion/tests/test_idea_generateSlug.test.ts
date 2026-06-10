import { describe, it, expect } from "vitest";
import { generateSlug } from "@aidev/idea";

describe("generateSlug", () => {
  it("converts title to lowercase kebab-case", () => {
    expect(generateSlug("My Great Idea")).toBe("my-great-idea");
  });

  it("strips special characters", () => {
    expect(generateSlug("feat: add OAuth!")).toBe("feat-add-oauth");
  });

  it("collapses consecutive separators", () => {
    expect(generateSlug("hello---world")).toBe("hello-world");
  });

  it("trims leading and trailing hyphens", () => {
    expect(generateSlug("--hello--")).toBe("hello");
  });

  it("truncates to 60 characters", () => {
    const longTitle = "a".repeat(100);
    expect(generateSlug(longTitle).length).toBeLessThanOrEqual(60);
  });

  it("handles unicode by stripping non-ascii", () => {
    expect(generateSlug("用 AST 做分析")).toBe("ast");
  });

  it("handles empty string", () => {
    expect(generateSlug("")).toBe("");
  });

  it("handles numbers", () => {
    expect(generateSlug("Phase 2 Planning")).toBe("phase-2-planning");
  });
});
