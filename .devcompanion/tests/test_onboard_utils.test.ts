import { describe, it, expect } from "vitest";
import { escapeHtml, escapeAttr, slugify } from "../../packages/render/src/onboard/utils.js";

describe("escapeHtml", () => {
  it("should escape ampersands", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("should escape angle brackets", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });

  it("should escape quotes", () => {
    expect(escapeHtml('say "hi"')).toBe("say &quot;hi&quot;");
  });

  it("should handle empty string", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("should handle text without special chars", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });
});

describe("escapeAttr", () => {
  it("should escape single quotes", () => {
    expect(escapeAttr("it's")).toBe("it&#39;s");
  });

  it("should escape double quotes", () => {
    expect(escapeAttr('say "hi"')).toBe("say &quot;hi&quot;");
  });

  it("should escape angle brackets", () => {
    expect(escapeAttr("<tag>")).toBe("&lt;tag&gt;");
  });
});

describe("slugify", () => {
  it("should replace non-alphanumeric chars with dashes", () => {
    expect(slugify("src/main.ts")).toBe("src-main-ts");
  });

  it("should handle dots and slashes", () => {
    expect(slugify("packages/ast/src/parser.ts")).toBe("packages-ast-src-parser-ts");
  });

  it("should preserve existing alphanumeric", () => {
    expect(slugify("hello123")).toBe("hello123");
  });

  it("should handle empty string", () => {
    expect(slugify("")).toBe("");
  });
});
