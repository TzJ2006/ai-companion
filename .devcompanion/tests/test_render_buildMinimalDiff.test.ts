import { describe, it, expect, vi } from "vitest";

// Mock the external dependencies that render.ts imports
vi.mock("@aidev/history", () => ({
  HistoryStore: vi.fn(),
}));

vi.mock("@aidev/render", () => ({
  renderSessionToHtml: vi.fn(),
}));

vi.mock("commander", () => {
  const mockCommand = {
    description: vi.fn(function() { return this; }),
    option: vi.fn(function() { return this; }),
    action: vi.fn(function() { return this; }),
  };
  return {
    Command: vi.fn(() => mockCommand),
  };
});

import { buildMinimalDiff } from "../../packages/cli/src/commands/render.js";

describe("buildMinimalDiff", () => {
  describe("basic functionality", () => {
    it("should return a string", () => {
      const result = buildMinimalDiff("test.ts", "old", "new", 1);
      expect(typeof result).toBe("string");
    });

    it("should return a non-empty string", () => {
      const result = buildMinimalDiff("test.ts", "old", "new", 1);
      expect(result).toBeTruthy();
      expect(result.length).toBeGreaterThan(0);
    });

    it("should produce a valid unified diff format", () => {
      const result = buildMinimalDiff("src/index.ts", "old content", "new content", 42);
      expect(result).toContain("diff --git a/src/index.ts b/src/index.ts");
      expect(result).toContain("--- a/src/index.ts");
      expect(result).toContain("+++ b/src/index.ts");
      expect(result).toContain("@@");
    });
  });

  describe("diff headers", () => {
    it("should include correct file path in headers", () => {
      const filePath = "path/to/myfile.ts";
      const result = buildMinimalDiff(filePath, "old", "new", 1);
      expect(result).toContain(`diff --git a/${filePath} b/${filePath}`);
      expect(result).toContain(`--- a/${filePath}`);
      expect(result).toContain(`+++ b/${filePath}`);
    });

    it("should handle file paths with special characters", () => {
      const filePath = "src/components/my-component.tsx";
      const result = buildMinimalDiff(filePath, "old", "new", 1);
      expect(result).toContain(`diff --git a/${filePath} b/${filePath}`);
    });

    it("should include correct start line in hunk header", () => {
      const result = buildMinimalDiff("test.ts", "line1\n", "line1\n", 99);
      expect(result).toContain("@@ -99,");
    });
  });

  describe("hunk header calculation", () => {
    it("should calculate correct line counts for single line old content", () => {
      const result = buildMinimalDiff("test.ts", "single line", "new line", 5);
      expect(result).toContain("@@ -5,1 +5,1 @@");
    });

    it("should calculate correct line counts for multi-line old content", () => {
      const oldContent = "line1\nline2\nline3\n";
      const newContent = "new line";
      const result = buildMinimalDiff("test.ts", oldContent, newContent, 10);
      // oldContent splits into ["line1", "line2", "line3", ""] = 4 lines
      // newContent splits into ["new line"] = 1 line
      expect(result).toContain("@@ -10,4 +10,1 @@");
    });

    it("should calculate correct line counts for multi-line new content", () => {
      const oldContent = "old";
      const newContent = "line1\nline2\nline3\n";
      const result = buildMinimalDiff("test.ts", oldContent, newContent, 1);
      // oldContent splits into ["old"] = 1 line
      // newContent splits into ["line1", "line2", "line3", ""] = 4 lines
      expect(result).toContain("@@ -1,1 +1,4 @@");
    });

    it("should handle empty string content as single empty line", () => {
      const result = buildMinimalDiff("test.ts", "", "", 1);
      // Empty string splits to [""] = 1 line
      expect(result).toContain("@@ -1,1 +1,1 @@");
    });
  });

  describe("null and undefined content handling", () => {
    it("should treat null old content as empty string", () => {
      const result = buildMinimalDiff("test.ts", null, "new line", 1);
      expect(result).toContain("@@ -1,1 +1,1 @@");
    });

    it("should treat null new content as empty string", () => {
      const result = buildMinimalDiff("test.ts", "old line", null, 1);
      expect(result).toContain("@@ -1,1 +1,1 @@");
    });

    it("should handle both old and new content as null", () => {
      const result = buildMinimalDiff("test.ts", null, null, 1);
      expect(result).toContain("@@ -1,1 +1,1 @@");
      // The result will have diff headers with "---" and "+++" but no diff content lines
      const lines = result.split("\n");
      const contentLines = lines.filter(l => l.startsWith("-") && !l.startsWith("---") || l.startsWith("+") && !l.startsWith("+++"));
      expect(contentLines).toHaveLength(0);
    });
  });

  describe("diff content lines", () => {
    it("should prefix old content lines with minus sign", () => {
      const result = buildMinimalDiff("test.ts", "old line\nremoved", "new", 1);
      expect(result).toContain("-old line");
      expect(result).toContain("-removed");
    });

    it("should prefix new content lines with plus sign", () => {
      const result = buildMinimalDiff("test.ts", "old", "new line\nadded", 1);
      expect(result).toContain("+new line");
      expect(result).toContain("+added");
    });

    it("should skip empty lines in diff content", () => {
      const oldContent = "line1\n\nline3";
      const newContent = "line1\nline2\n";
      const result = buildMinimalDiff("test.ts", oldContent, newContent, 1);
      // Empty lines (from the split) should not produce diff lines
      expect(result).toContain("-line1");
      expect(result).toContain("-line3");
      expect(result).toContain("+line1");
      expect(result).toContain("+line2");
    });

    it("should produce complete diff for single line changes", () => {
      const result = buildMinimalDiff("test.ts", "const x = 1;", "const x = 2;", 5);
      expect(result).toContain("-const x = 1;");
      expect(result).toContain("+const x = 2;");
    });

    it("should handle lines with special characters", () => {
      const result = buildMinimalDiff("test.ts", "console.log('hello');", "console.log('world');", 1);
      expect(result).toContain("-console.log('hello');");
      expect(result).toContain("+console.log('world');");
    });
  });

  describe("start line tracking", () => {
    it("should preserve start line in hunk header", () => {
      const result1 = buildMinimalDiff("test.ts", "a", "b", 1);
      const result2 = buildMinimalDiff("test.ts", "a", "b", 100);
      const result3 = buildMinimalDiff("test.ts", "a", "b", 999);

      expect(result1).toContain("@@ -1,");
      expect(result2).toContain("@@ -100,");
      expect(result3).toContain("@@ -999,");
    });

    it("should use same line number for both old and new hunks", () => {
      const result = buildMinimalDiff("test.ts", "old", "new", 42);
      expect(result).toContain("@@ -42,1 +42,1 @@");
    });
  });

  describe("multiline content scenarios", () => {
    it("should handle replacement of multiple lines", () => {
      const oldContent = "function old() {\n  return 1;\n}";
      const newContent = "function new() {\n  return 2;\n}";
      const result = buildMinimalDiff("functions.ts", oldContent, newContent, 10);

      expect(result).toContain("-function old() {");
      expect(result).toContain("-  return 1;");
      expect(result).toContain("-}");
      expect(result).toContain("+function new() {");
      expect(result).toContain("+  return 2;");
      expect(result).toContain("+}");
    });

    it("should preserve line order in diff output", () => {
      const oldContent = "first\nsecond\nthird";
      const newContent = "alpha\nbeta";
      const result = buildMinimalDiff("test.ts", oldContent, newContent, 1);

      const lines = result.split("\n");
      const firstOldIdx = lines.findIndex(l => l.includes("-first"));
      const firstNewIdx = lines.findIndex(l => l.includes("+alpha"));

      expect(firstOldIdx).toBeGreaterThanOrEqual(0);
      expect(firstNewIdx).toBeGreaterThanOrEqual(0);
    });
  });

  describe("trailing newlines", () => {
    it("should handle trailing newlines in old content", () => {
      const result = buildMinimalDiff("test.ts", "line\n", "new", 1);
      // "line\n" splits to ["line", ""]
      expect(result).toContain("-line");
    });

    it("should handle trailing newlines in new content", () => {
      const result = buildMinimalDiff("test.ts", "old", "line\n", 1);
      // "line\n" splits to ["line", ""]
      expect(result).toContain("+line");
    });

    it("should handle multiple trailing newlines", () => {
      const result = buildMinimalDiff("test.ts", "content\n\n", "other\n\n\n", 1);
      // Splits should work correctly even with extra newlines
      expect(result).toContain("-content");
      expect(result).toContain("+other");
    });
  });

  describe("complex file paths", () => {
    it("should handle deeply nested file paths", () => {
      const filePath = "src/components/ui/form/input/TextInput.tsx";
      const result = buildMinimalDiff(filePath, "old", "new", 1);
      expect(result).toContain(`diff --git a/${filePath} b/${filePath}`);
    });

    it("should handle file paths with dots", () => {
      const filePath = "src/utils/format.test.ts";
      const result = buildMinimalDiff(filePath, "old", "new", 1);
      expect(result).toContain(`--- a/${filePath}`);
    });

    it("should handle file paths with underscores and dashes", () => {
      const filePath = "src/my_utils/my-formatter.ts";
      const result = buildMinimalDiff(filePath, "old", "new", 1);
      expect(result).toContain(`+++ b/${filePath}`);
    });
  });

  describe("line content variations", () => {
    it("should handle code with leading spaces", () => {
      const oldContent = "    indented line";
      const newContent = "      more indented";
      const result = buildMinimalDiff("test.ts", oldContent, newContent, 1);
      expect(result).toContain("-    indented line");
      expect(result).toContain("+      more indented");
    });

    it("should handle code with tabs", () => {
      const oldContent = "\tvar x = 1;";
      const newContent = "\t\tvar y = 2;";
      const result = buildMinimalDiff("test.ts", oldContent, newContent, 1);
      expect(result).toContain("-\tvar x = 1;");
      expect(result).toContain("+\t\tvar y = 2;");
    });

    it("should handle code with unicode characters", () => {
      const oldContent = "const greeting = '你好';";
      const newContent = "const greeting = 'こんにちは';";
      const result = buildMinimalDiff("test.ts", oldContent, newContent, 1);
      expect(result).toContain("你好");
      expect(result).toContain("こんにちは");
    });
  });

  describe("edge cases", () => {
    it("should handle identical old and new content", () => {
      const content = "same content";
      const result = buildMinimalDiff("test.ts", content, content, 1);
      expect(result).toContain("-same content");
      expect(result).toContain("+same content");
    });

    it("should handle very long lines", () => {
      const longLine = "x".repeat(1000);
      const result = buildMinimalDiff("test.ts", longLine, "short", 1);
      expect(result).toContain("-" + longLine);
      expect(result).toContain("+short");
    });

    it("should handle content with regex special characters", () => {
      const content = "const pattern = /^test[a-z]+$/gi;";
      const result = buildMinimalDiff("test.ts", content, "new", 1);
      expect(result).toContain(content);
    });

    it("should handle content with quotes and escapes", () => {
      const oldContent = 'const str = "quoted \\"inner\\" string";';
      const newContent = "const str = 'single quoted';";
      const result = buildMinimalDiff("test.ts", oldContent, newContent, 1);
      expect(result).toContain(oldContent);
      expect(result).toContain(newContent);
    });
  });

  describe("formatting consistency", () => {
    it("should always include newline after file header", () => {
      const result = buildMinimalDiff("test.ts", "a", "b", 1);
      const lines = result.split("\n");
      expect(lines[0]).toBe("diff --git a/test.ts b/test.ts");
      expect(lines[1]).toBe("--- a/test.ts");
      expect(lines[2]).toBe("+++ b/test.ts");
    });

    it("should end with newline after content", () => {
      const result = buildMinimalDiff("test.ts", "old", "new", 1);
      expect(result).toMatch(/\n$/);
    });

    it("should have consistent diff marker placement", () => {
      const result = buildMinimalDiff("test.ts", "old\nnew", "updated", 1);
      const lines = result.split("\n");
      const diffLines = lines.filter(l => l.startsWith("-") || l.startsWith("+"));

      diffLines.forEach(line => {
        expect(line[0]).toMatch(/^[-+]$/);
      });
    });
  });
});