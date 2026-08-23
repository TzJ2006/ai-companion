import { describe, it, expect, beforeEach } from "vitest";
import type { ReviewSession, ChangeRecord } from "@aidev/history";

import { renderSessionToHtml, escapeHtml, type RenderOptions } from "../../packages/render/src/renderer.js";

// Helper: build a fully-populated ChangeRecord so the renderer never reads undefined fields.
function makeChange(overrides: Partial<ChangeRecord> = {}): ChangeRecord {
  return {
    id: "chg-1",
    timestamp: "2024-01-15T10:30:00Z",
    file_path: "src/app.ts",
    function_hash: "abc123def456",
    function_name: "initApp",
    class_name: null,
    change_type: "modify",
    reason: "Refactored initialization logic",
    reason_source: "context",
    old_content: "// old code",
    new_content: "// new code",
    start_line: 10,
    end_line: 25,
    test_status: "pass",
    test_file: null,
    error_id: null,
    session_id: "sess-1",
    ...overrides
  };
}

describe("renderSessionToHtml", () => {
  let mockSession: ReviewSession;
  let mockDiffs: string[];

  // Build a fresh session before each test.
  const buildSession = (): ReviewSession => ({
    id: "sess-1",
    timestamp: "2024-01-15T10:30:00Z",
    trigger: "hook",
    summary: "Updated app logic and utility functions",
    total_changes: 3,
    files_changed: ["src/app.ts", "src/utils.ts"],
    changes: [
      makeChange({
        id: "chg-1",
        file_path: "src/app.ts",
        function_hash: "hash-initapp",
        start_line: 10,
        end_line: 25,
        function_name: "initApp",
        change_type: "modify",
        reason: "Refactored initialization logic",
        reason_source: "context",
        test_status: "pass"
      }),
      makeChange({
        id: "chg-2",
        file_path: "src/utils.ts",
        function_hash: "hash-parsedata",
        start_line: 5,
        end_line: 8,
        function_name: "parseData",
        change_type: "add",
        reason: "Added new utility function",
        reason_source: "user-provided",
        test_status: "pass",
        error_id: "101"
      }),
      makeChange({
        id: "chg-3",
        file_path: "src/app.ts",
        function_hash: "hash-cleanup",
        start_line: 40,
        end_line: 42,
        function_name: "cleanup",
        change_type: "delete",
        reason: "Removed deprecated code",
        reason_source: "llm-inferred",
        test_status: "fail"
      })
    ]
  });

  beforeEach(() => {
    mockSession = buildSession();
    mockDiffs = [
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -10,16 +10,20 @@",
      " function initApp() {",
      "-  // old code",
      "+  // new code"
    ];
  });

  it("should generate valid HTML document structure", () => {
    const result = renderSessionToHtml(mockSession);
    expect(result).toContain("<!DOCTYPE html>");
    expect(result).toContain('<html lang="en">');
    expect(result).toContain("</html>");
    expect(result).toMatch(/<title>.*<\/title>/);
  });

  it("should use session timestamp as default title", () => {
    const result = renderSessionToHtml(mockSession);
    expect(result).toContain("Review: 2024-01-15T10:30:00Z");
  });

  it("should use custom title when provided", () => {
    const options: RenderOptions = {
      title: "Security Code Review",
    };
    const result = renderSessionToHtml(mockSession, options);
    expect(result).toContain("<title>Security Code Review</title>");
  });

  it("should display total changes and file count in summary", () => {
    const result = renderSessionToHtml(mockSession);
    expect(result).toContain("<strong>3</strong> changes");
    expect(result).toContain("<strong>2</strong> files");
  });

  it("should include session summary text", () => {
    const result = renderSessionToHtml(mockSession);
    expect(result).toContain("Updated app logic and utility functions");
  });

  it("should list all changed files in summary", () => {
    const result = renderSessionToHtml(mockSession);
    expect(result).toContain("src/app.ts");
    expect(result).toContain("src/utils.ts");
  });

  it("should display change types for each file", () => {
    const result = renderSessionToHtml(mockSession);
    expect(result).toContain("modify");
    expect(result).toContain("add");
    expect(result).toContain("delete");
  });

  it("should apply test-status-aware badge classes per change type", () => {
    const options: RenderOptions = {
    };
    const result = renderSessionToHtml(mockSession, options);
    // Current renderer encodes change outcome via fn-badge-* classes.
    expect(result).toContain("fn-badge-modify");
    expect(result).toContain("fn-badge-delete");
  });

  it("should render add changes with the add badge", () => {
    const options: RenderOptions = {
    };
    const result = renderSessionToHtml(mockSession, options);
    expect(result).toContain("fn-badge-add");
  });

  it("should include reason source labels for each change", () => {
    const options: RenderOptions = {
    };
    const result = renderSessionToHtml(mockSession, options);
    // Reason sources are surfaced in the reason-meta line.
    expect(result).toContain("context");
    expect(result).toContain("user-provided");
  });

  it("should not emit numeric error-id markup", () => {
    const options: RenderOptions = {
    };
    const result = renderSessionToHtml(mockSession, options);
    // Error-id display is no longer part of the markup.
    expect(result).not.toContain("Error #101");
  });

  it("should include all change annotations with function names", () => {
    const result = renderSessionToHtml(mockSession);
    expect(result).toContain('class="fn-name">initApp');
    expect(result).toContain('class="fn-name">parseData');
    expect(result).toContain('class="fn-name">cleanup');
  });

  it("should include change reasons in annotations", () => {
    const result = renderSessionToHtml(mockSession);
    expect(result).toContain("Refactored initialization logic");
    expect(result).toContain("Added new utility function");
    expect(result).toContain("Removed deprecated code");
  });

  it("should show line number ranges for each change", () => {
    const result = renderSessionToHtml(mockSession);
    expect(result).toContain("L10–25");
    expect(result).toContain("L5–8");
    expect(result).toContain("L40–42");
  });

  it("should include reason source for each annotation", () => {
    const result = renderSessionToHtml(mockSession);
    expect(result).toContain("context");
    expect(result).toContain("user-provided");
    expect(result).toContain("llm-inferred");
  });

  it("should group changes and report per-group counts", () => {
    const result = renderSessionToHtml(mockSession);
    // Each distinct reason becomes its own group with a count label.
    expect(result).toContain("reason-group");
    expect(result).toContain("1 change");
  });

  it("should include collapsible group/function controls for navigation", () => {
    const result = renderSessionToHtml(mockSession);
    expect(result).toContain("toggleGroup(this)");
    expect(result).toContain("toggleFn(");
    expect(result).toContain('id="fn-hash-initapp-10"');
  });

  it("should escape HTML in title", () => {
    const options: RenderOptions = {
      title: "<script>alert('xss')</script>",
    };
    const result = renderSessionToHtml(mockSession, options);
    expect(result).toContain("&lt;script&gt;");
    expect(result).not.toContain("<script>alert");
  });

  it("should escape HTML in session summary", () => {
    const sessionWithHtml: ReviewSession = {
      ...mockSession,
      summary: "Changes to <SecurityModule> & authentication"
    };
    const result = renderSessionToHtml(sessionWithHtml);
    expect(result).toContain("&lt;SecurityModule&gt;");
    expect(result).toContain("&amp;");
  });

  it("should escape HTML in change reasons", () => {
    const sessionWithHtml: ReviewSession = {
      ...mockSession,
      changes: [
        makeChange({
          ...mockSession.changes[0],
          reason: "Fixed <vulnerability> in parser & validator"
        })
      ]
    };
    const result = renderSessionToHtml(sessionWithHtml);
    expect(result).toContain("&lt;vulnerability&gt;");
    expect(result).toContain("&amp;");
  });

  it("should include required meta tags", () => {
    const result = renderSessionToHtml(mockSession);
    expect(result).toContain('<meta charset="UTF-8">');
    expect(result).toContain('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
  });

  it("should embed inline stylesheet (no external diff stylesheet link)", () => {
    const result = renderSessionToHtml(mockSession);
    // Styling is now inline; there is no external diff stylesheet.
    expect(result).toContain("<style>");
    expect(result).not.toContain("diff2html.min.css");
  });

  it("should include CSS variables for dark theme", () => {
    const result = renderSessionToHtml(mockSession);
    expect(result).toContain("--bg: #1a1a2e");
    expect(result).toContain("--fg: #eaeaea");
    expect(result).toContain("--accent: #4fc3f7");
    expect(result).toContain("--green: #66bb6a");
    expect(result).toContain("--red: #ef5350");
  });

  it("should use a centered container layout", () => {
    const result = renderSessionToHtml(mockSession);
    expect(result).toContain(".container");
    expect(result).toContain("max-width: 960px");
  });

  it("should include summary bar and reason group sections", () => {
    const result = renderSessionToHtml(mockSession);
    expect(result).toContain("summary-bar");
    expect(result).toContain("summary-stat");
    expect(result).toContain("reason-group");
    expect(result).toContain("reason-header");
  });

  it("should handle empty changes array", () => {
    const emptySession: ReviewSession = {
      ...mockSession,
      total_changes: 0,
      files_changed: [],
      changes: []
    };
    const result = renderSessionToHtml(emptySession);
    expect(result).toContain("<strong>0</strong> changes");
  });

  it("should apply correct change type CSS classes", () => {
    const result = renderSessionToHtml(mockSession);
    expect(result).toContain("fn-badge-add");
    expect(result).toContain("fn-badge-modify");
    expect(result).toContain("fn-badge-delete");
  });

  it("should render an inline diff block for content changes", () => {
    const options: RenderOptions = {
    };
    const result = renderSessionToHtml(mockSession, options);
    // Diffs are rendered inline (no diff2html); content lines are present.
    expect(result).toContain("diff-block");
    expect(result).toContain("// old code");
    expect(result).toContain("// new code");
  });

  it("should render added and removed diff line markers", () => {
    const result = renderSessionToHtml(mockSession);
    expect(result).toContain("diff-add");
    expect(result).toContain("diff-del");
  });

  it("should show an empty-diff placeholder when no content is present", () => {
    const sessionNoContent: ReviewSession = {
      ...mockSession,
      total_changes: 1,
      files_changed: ["src/utils.ts"],
      changes: [
        makeChange({
          file_path: "src/utils.ts",
          function_name: "helper",
          change_type: "add",
          reason: "New helper function",
          reason_source: "user-provided",
          old_content: null,
          new_content: null
        })
      ]
    };
    const result = renderSessionToHtml(sessionNoContent);
    expect(result).toContain("No diff content available");
  });

  it("should render a change that has no error_id field", () => {
    const sessionNoError: ReviewSession = {
      ...mockSession,
      total_changes: 1,
      files_changed: ["src/utils.ts"],
      changes: [
        makeChange({
          file_path: "src/utils.ts",
          start_line: 1,
          end_line: 3,
          function_name: "helper",
          change_type: "add",
          reason: "New helper function",
          reason_source: "user-provided",
          error_id: null
        })
      ]
    };
    const options: RenderOptions = {
    };
    const result = renderSessionToHtml(sessionNoError, options);
    expect(result).not.toContain("Error #");
    expect(result).toContain('class="fn-name">helper');
  });

  it("should include reason group header elements", () => {
    const result = renderSessionToHtml(mockSession);
    expect(result).toContain("reason-header");
    expect(result).toContain("reason-text");
    expect(result).toContain("reason-meta");
  });

  it("should include function item body elements", () => {
    const result = renderSessionToHtml(mockSession);
    expect(result).toContain("fn-item");
    expect(result).toContain("fn-header");
    expect(result).toContain("fn-diff");
  });

  it("should use default options when none provided", () => {
    const result = renderSessionToHtml(mockSession);
    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("should aggregate multiple change types for same file", () => {
    const result = renderSessionToHtml(mockSession);
    // src/app.ts appears in both modify and delete changes
    const appTsCount = (result.match(/src\/app\.ts/g) || []).length;
    expect(appTsCount).toBeGreaterThan(1);
  });

  it("should render file paths in file-path sections", () => {
    const result = renderSessionToHtml(mockSession);
    expect(result).toContain('class="file-path">src/app.ts');
    expect(result).toContain('class="file-path">src/utils.ts');
  });

  it("should render an ECL tag when ecl_context is present", () => {
    const sessionWithEcl: ReviewSession = {
      ...mockSession,
      total_changes: 1,
      files_changed: ["src/app.ts"],
      changes: [
        makeChange({
          reason: "Implement guarded feature",
          ecl_context: { feature: "auth-flow", ecl_file: "docs/ecl/auth.yaml", decisions: ["use-jwt"] }
        })
      ]
    };
    const result = renderSessionToHtml(sessionWithEcl);
    expect(result).toContain("ecl-tag");
    expect(result).toContain("auth-flow");
  });
});

describe("escapeHtml", () => {
  it("should escape ampersand", () => {
    expect(escapeHtml("Tom & Jerry")).toBe("Tom &amp; Jerry");
  });

  it("should escape less than symbol", () => {
    expect(escapeHtml("a < b")).toBe("a &lt; b");
  });

  it("should escape greater than symbol", () => {
    expect(escapeHtml("a > b")).toBe("a &gt; b");
  });

  it("should escape double quotes", () => {
    expect(escapeHtml('He said "hello"')).toBe('He said &quot;hello&quot;');
  });

  it("should escape all HTML special characters together", () => {
    const result = escapeHtml('<div class="test">A & B</div>');
    expect(result).toBe('&lt;div class=&quot;test&quot;&gt;A &amp; B&lt;/div&gt;');
  });

  it("should not modify plain text", () => {
    expect(escapeHtml("Hello World 123")).toBe("Hello World 123");
  });

  it("should handle empty string", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("should escape multiple occurrences of same character", () => {
    expect(escapeHtml("A & B & C")).toBe("A &amp; B &amp; C");
  });

  it("should escape XSS payload", () => {
    const result = escapeHtml('<img src=x onerror="alert(1)">');
    expect(result).not.toContain("<img");
    expect(result).toContain("&lt;img");
    expect(result).toContain("&quot;");
  });

  it("should escape script tag", () => {
    const result = escapeHtml("<script>malicious()</script>");
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;script&gt;");
  });

  it("should preserve whitespace", () => {
    const result = escapeHtml("  text  \n  more  ");
    expect(result).toContain("  text  ");
    expect(result).toContain("  more  ");
  });

  it("should handle single special characters", () => {
    expect(escapeHtml("&")).toBe("&amp;");
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml(">")).toBe("&gt;");
    expect(escapeHtml('"')).toBe("&quot;");
  });
});
