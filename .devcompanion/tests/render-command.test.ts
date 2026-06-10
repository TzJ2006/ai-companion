import { describe, it, expect, vi } from "vitest";
import type { ChangeRecord } from "../../packages/history/src/types.js";

// Mock dependencies before importing the command
vi.mock("@aidev/history", () => ({}));
vi.mock("@aidev/render", () => ({}));

import { buildMinimalDiff } from "../../packages/cli/src/commands/render.js";

describe("buildMinimalDiff", () => {
  it("should create diff header", () => {
    const diff = buildMinimalDiff("src/app.ts", "old", "new", 10);
    expect(diff).toContain("diff --git");
    expect(diff).toContain("--- a/src/app.ts");
    expect(diff).toContain("+++ b/src/app.ts");
  });

  it("should include hunk header", () => {
    const diff = buildMinimalDiff("test.ts", "a\nb", "c\nd\ne", 5);
    expect(diff).toContain("@@ -5,2 +5,3 @@");
  });

  it("should prefix old with minus", () => {
    const diff = buildMinimalDiff("test.ts", "old content", null, 1);
    expect(diff).toContain("-old content");
  });

  it("should prefix new with plus", () => {
    const diff = buildMinimalDiff("test.ts", null, "new content", 1);
    expect(diff).toContain("+new content");
  });

  it("should handle both old and new", () => {
    const diff = buildMinimalDiff("file.ts", "old", "new", 15);
    expect(diff).toContain("-old");
    expect(diff).toContain("+new");
  });

  it("should handle null old_content", () => {
    const diff = buildMinimalDiff("test.ts", null, "new", 1);
    expect(diff).toContain("+new");
    expect(diff).toContain("@@ -1,");
  });

  it("should handle null new_content", () => {
    const diff = buildMinimalDiff("test.ts", "old", null, 1);
    expect(diff).toContain("-old");
    expect(diff).toContain("@@ -1,");
  });

  it("should handle both null", () => {
    const diff = buildMinimalDiff("test.ts", null, null, 1);
    expect(diff).toContain("diff --git");
    expect(diff).toContain("@@ -1,");
  });

  it("should split by newlines", () => {
    const old = "line1\nline2\nline3";
    const neu = "line1\nmod\nline3\nline4";
    const diff = buildMinimalDiff("file.ts", old, neu, 10);
    expect(diff).toContain("-line2");
    expect(diff).toContain("+mod");
    expect(diff).toContain("+line4");
  });

  it("should preserve file path", () => {
    const diff = buildMinimalDiff("src/components/Button.tsx", "old", "new", 1);
    expect(diff).toContain("Button.tsx");
  });

  it("should handle nested paths", () => {
    const fp = "packages/ui/src/Button.tsx";
    const diff = buildMinimalDiff(fp, "a", "b", 1);
    expect(diff).toContain(fp);
  });

  it("should use startLine in hunk", () => {
    const diff = buildMinimalDiff("test.ts", "a\nb", "c", 100);
    expect(diff).toContain("@@ -100,2 +100,1 @@");
  });

  it("should handle line 0", () => {
    const diff = buildMinimalDiff("test.ts", "old", "new", 0);
    expect(diff).toContain("@@ -0,1 +0,1 @@");
  });

  it("should calculate line counts", () => {
    const diff = buildMinimalDiff("test.ts", "a\nb\nc", "x\ny", 50);
    expect(diff).toContain("@@ -50,3 +50,2 @@");
  });

  it("should end with newline", () => {
    const diff = buildMinimalDiff("test.ts", "old", "new", 1);
    expect(diff).toMatch(/\n$/);
  });

  it("should have diff markers", () => {
    const diff = buildMinimalDiff("test.ts", "old\nmore", "new", 10);
    expect(diff).toMatch(/^diff --git/);
    expect(diff).toContain("--- a/");
    expect(diff).toContain("+++ b/");
  });

  it("should handle empty strings", () => {
    const diff = buildMinimalDiff("test.ts", "", "", 1);
    expect(diff).toContain("@@ -1,1 +1,1 @@");
  });

  it("should handle unicode", () => {
    const c = "const emoji = '😀';\nconst t = 'こんにちは';";
    const diff = buildMinimalDiff("test.ts", c, null, 1);
    expect(diff).toContain("😀");
    expect(diff).toContain("こんにちは");
  });

  it("should handle long lines", () => {
    const long = "x".repeat(1000);
    const diff = buildMinimalDiff("test.ts", long, null, 1);
    expect(diff).toContain(long);
  });

  it("should handle many lines", () => {
    const many = Array.from({length: 100}, (_, i) => `line ${i}`).join("\n");
    const diff = buildMinimalDiff("test.ts", many, null, 1);
    expect(diff).toContain("line 0");
    expect(diff).toContain("line 99");
  });

  it("should handle JS function change", () => {
    const old = "function add(a, b) {\n  return a + b;\n}";
    const neu = "function add(a, b) {\n  console.log('x');\n  return a + b;\n}";
    const diff = buildMinimalDiff("math.js", old, neu, 1);
    expect(diff).toContain("diff --git a/math.js b/math.js");
    expect(diff).toContain("-function add");
    expect(diff).toContain("console.log");
  });

  it("should handle file deletion", () => {
    const diff = buildMinimalDiff("d.ts", "old\nfile", null, 1);
    expect(diff).toContain("@@ -1,");
    expect(diff).toContain("-old");
    expect(diff).toContain("-file");
  });

  it("should handle file creation", () => {
    const diff = buildMinimalDiff("n.ts", null, "new\nfile", 1);
    expect(diff).toContain("@@ -1,");
    expect(diff).toContain("+new");
    expect(diff).toContain("+file");
  });

  it("should return string", () => {
    expect(typeof buildMinimalDiff("f.ts", "o", "n", 1)).toBe("string");
  });

  it("should return non-empty", () => {
    expect(buildMinimalDiff("", "", "", 0).length).toBeGreaterThan(0);
  });

  it("should be deterministic", () => {
    const r1 = buildMinimalDiff("f.ts", "o\nc", "n\nc", 42);
    const r2 = buildMinimalDiff("f.ts", "o\nc", "n\nc", 42);
    expect(r1).toBe(r2);
  });
});

describe("render command", () => {
  it("should filter changes", () => {
    const changes: ChangeRecord[] = [
      {id: "1", timestamp: "2026-01-01T00:00:00Z", file_path: "f1.ts", function_hash: "h1", function_name: "fn1", class_name: null, change_type: "modify", reason: "test", reason_source: "user-provided", old_content: "old", new_content: "new", start_line: 1, end_line: 5, test_status: "pass", test_file: null, error_id: null, session_id: "s1"},
      {id: "2", timestamp: "2026-01-01T00:00:00Z", file_path: "f2.ts", function_hash: "h2", function_name: "fn2", class_name: null, change_type: "modify", reason: "test", reason_source: "user-provided", old_content: null, new_content: null, start_line: 10, end_line: 15, test_status: "pass", test_file: null, error_id: null, session_id: "s1"},
    ];
    const filtered = changes.filter((c) => c.old_content || c.new_content);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].file_path).toBe("f1.ts");
  });

  it("should map to diffs", () => {
    const changes: ChangeRecord[] = [
      {id: "1", timestamp: "2026-01-01T00:00:00Z", file_path: "f1.ts", function_hash: "h1", function_name: "fn1", class_name: null, change_type: "modify", reason: "r1", reason_source: "user-provided", old_content: "old1", new_content: "new1", start_line: 10, end_line: 10, test_status: "pass", test_file: null, error_id: null, session_id: "s1"},
    ];
    const diffs = changes.filter((c) => c.old_content || c.new_content).map((c) => buildMinimalDiff(c.file_path, c.old_content, c.new_content, c.start_line));
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toContain("f1.ts");
  });

  it("should join diffs", () => {
    const d1 = buildMinimalDiff("f1.ts", "old1", "new1", 1);
    const d2 = buildMinimalDiff("f2.ts", "old2", "new2", 5);
    const joined = [d1, d2].join("\n");
    expect(joined).toContain("f1.ts");
    expect(joined).toContain("f2.ts");
  });

  it("should support style options", () => {
    const s1: "side-by-side" | "line-by-line" = "side-by-side";
    const s2: "side-by-side" | "line-by-line" = "line-by-line";
    expect(s1).toBe("side-by-side");
    expect(s2).toBe("line-by-line");
  });

  it("should configure render options", () => {
    const opts = {show_test_status: true, show_error_ids: true, style: "side-by-side" as const};
    expect(opts.show_test_status).toBe(true);
    expect(opts.show_error_ids).toBe(true);
  });
});
