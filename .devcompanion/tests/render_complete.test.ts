import { describe, it, expect, beforeEach } from "vitest";
import type { ReviewSession, ChangeRecord } from "@aidev/history";

import { renderSessionToHtml, type RenderOptions } from "../../packages/render/src/renderer.js";

function makeSession(): ReviewSession {
  return {
    id: "session-123",
    timestamp: "2024-01-15T10:30:00Z",
    trigger: "hook",
    total_changes: 3,
    files_changed: ["src/app.ts", "src/utils.ts"],
    summary: "Updated app logic and utility functions",
    changes: [
      {
        id: "change-1",
        timestamp: "2024-01-15T10:30:00Z",
        file_path: "src/app.ts",
        function_hash: "hash1",
        function_name: "initApp",
        class_name: null,
        change_type: "modify",
        reason: "Refactored initialization logic",
        reason_source: "context",
        old_content: "function initApp() {}",
        new_content: "function initApp() { /* updated */ }",
        start_line: 10,
        end_line: 25,
        test_status: "pass",
        test_file: "src/app.test.ts",
        error_id: null,
        session_id: "session-123"
      },
      {
        id: "change-2",
        timestamp: "2024-01-15T10:30:00Z",
        file_path: "src/utils.ts",
        function_hash: "hash2",
        function_name: "parseData",
        class_name: null,
        change_type: "add",
        reason: "Added new utility function",
        reason_source: "llm-inferred",
        old_content: null,
        new_content: "function parseData(input) { return JSON.parse(input); }",
        start_line: 5,
        end_line: 8,
        test_status: "pass",
        test_file: null,
        error_id: "101",
        session_id: "session-123"
      },
      {
        id: "change-3",
        timestamp: "2024-01-15T10:30:00Z",
        file_path: "src/app.ts",
        function_hash: "hash3",
        function_name: "cleanup",
        class_name: null,
        change_type: "delete",
        reason: "Removed deprecated code",
        reason_source: "user-provided",
        old_content: "function cleanup() {}",
        new_content: null,
        start_line: 40,
        end_line: 42,
        test_status: "fail",
        test_file: null,
        error_id: null,
        session_id: "session-123"
      }
    ]
  };
}

describe("renderSessionToHtml", () => {
  let mockSession: ReviewSession;
  // _rawDiffs is ignored by the current renderer; kept to exercise the 2nd-slot arg.
  const mockDiffs: string[] = [
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -10,16 +10,20 @@",
    " function initApp() {",
    "-  // old code",
    "+  // new code"
  ];

  beforeEach(() => {
    mockSession = makeSession();
  });

  it("should generate valid HTML document structure", () => {
    const result = renderSessionToHtml(mockSession, mockDiffs);
    expect(result).toContain("<!DOCTYPE html>");
    expect(result).toContain('<html lang="en">');
    expect(result).toContain("</html>");
    expect(result).toMatch(/<title>.*<\/title>/);
  });

  it("should use session timestamp as default title", () => {
    const result = renderSessionToHtml(mockSession, mockDiffs);
    expect(result).toContain("Review: 2024-01-15T10:30:00Z");
  });

  it("should use custom title when provided", () => {
    const options: RenderOptions = {
      title: "Security Code Review",
      show_test_status: true,
      show_error_ids: true,
      style: "side-by-side"
    };
    const result = renderSessionToHtml(mockSession, mockDiffs, options);
    expect(result).toContain("<title>Security Code Review</title>");
  });

  it("should display total changes and file count in summary", () => {
    const result = renderSessionToHtml(mockSession, mockDiffs);
    expect(result).toContain('<div class="summary-stat"><strong>3</strong> changes</div>');
    expect(result).toContain('<div class="summary-stat"><strong>2</strong> files</div>');
  });

  it("should include session summary text", () => {
    const result = renderSessionToHtml(mockSession, mockDiffs);
    expect(result).toContain("Updated app logic and utility functions");
  });

  it("should list all changed files in summary", () => {
    const result = renderSessionToHtml(mockSession, mockDiffs);
    expect(result).toContain("src/app.ts");
    expect(result).toContain("src/utils.ts");
  });

  it("should display change types for each file", () => {
    const result = renderSessionToHtml(mockSession, mockDiffs);
    expect(result).toContain(">modify</span>");
    expect(result).toContain(">add</span>");
    expect(result).toContain(">delete</span>");
  });

  it("should render change-type badges with the correct classes", () => {
    const options: RenderOptions = {
      show_test_status: true,
      show_error_ids: false,
      style: "side-by-side"
    };
    const result = renderSessionToHtml(mockSession, mockDiffs, options);
    expect(result).toContain("fn-badge fn-badge-modify");
    expect(result).toContain("fn-badge fn-badge-add");
    expect(result).toContain("fn-badge fn-badge-delete");
  });

  it("should render the inline diff block instead of an external diff renderer", () => {
    const options: RenderOptions = {
      show_test_status: false,
      show_error_ids: false,
      style: "side-by-side"
    };
    const result = renderSessionToHtml(mockSession, mockDiffs, options);
    expect(result).toContain('class="diff-block"');
    // The current renderer builds the diff inline, never linking an external CSS sheet.
    expect(result).not.toContain("diff2html.min.css");
  });

  it("should render reason-source metadata for each reason group", () => {
    const options: RenderOptions = {
      show_test_status: false,
      show_error_ids: true,
      style: "side-by-side"
    };
    const result = renderSessionToHtml(mockSession, mockDiffs, options);
    expect(result).toContain("context");
    expect(result).toContain("llm-inferred");
    expect(result).toContain("user-provided");
  });

  it("should render delete changes as removed diff lines", () => {
    const options: RenderOptions = {
      show_test_status: true,
      show_error_ids: false,
      style: "side-by-side"
    };
    const result = renderSessionToHtml(mockSession, mockDiffs, options);
    expect(result).toContain('class="diff-line diff-del"');
  });

  it("should include all change annotations with function names", () => {
    const result = renderSessionToHtml(mockSession, mockDiffs);
    expect(result).toContain('class="fn-name">initApp</span>');
    expect(result).toContain('class="fn-name">parseData</span>');
    expect(result).toContain('class="fn-name">cleanup</span>');
  });

  it("should include change reasons in annotations", () => {
    const result = renderSessionToHtml(mockSession, mockDiffs);
    expect(result).toContain("Refactored initialization logic");
    expect(result).toContain("Added new utility function");
    expect(result).toContain("Removed deprecated code");
  });

  it("should show line number ranges for each change", () => {
    const result = renderSessionToHtml(mockSession, mockDiffs);
    expect(result).toContain("L10–25");
    expect(result).toContain("L5–8");
    expect(result).toContain("L40–42");
  });

  it("should include reason source for each annotation", () => {
    const result = renderSessionToHtml(mockSession, mockDiffs);
    expect(result).toContain("context");
    expect(result).toContain("llm-inferred");
    expect(result).toContain("user-provided");
  });

  it("should group changes under collapsible reason groups", () => {
    const result = renderSessionToHtml(mockSession, mockDiffs);
    expect(result).toContain('class="reason-group"');
    expect(result).toContain('class="reason-header"');
    expect(result).toContain('class="reason-text"');
  });

  it("should attach toggle handlers for function-level diffs", () => {
    const result = renderSessionToHtml(mockSession, mockDiffs);
    // Each function item gets a stable id derived from hash + start line.
    expect(result).toContain('id="fn-hash1-10"');
    expect(result).toContain('id="fn-hash2-5"');
    expect(result).toContain("toggleFn(");
  });

  it("should escape HTML in title", () => {
    const options: RenderOptions = {
      title: "<script>alert('xss')</script>",
      show_test_status: true,
      show_error_ids: true,
      style: "side-by-side"
    };
    const result = renderSessionToHtml(mockSession, mockDiffs, options);
    expect(result).toContain("&lt;script&gt;");
    expect(result).not.toContain("<script>alert");
  });

  it("should include session summary in output", () => {
    const sessionWithSummary: ReviewSession = {
      ...mockSession,
      summary: "Important changes to module and authentication"
    };
    const result = renderSessionToHtml(sessionWithSummary, mockDiffs);
    expect(result).toContain("Important changes to module and authentication");
  });

  it("should escape HTML in change reasons", () => {
    const sessionWithHtml: ReviewSession = {
      ...mockSession,
      changes: [
        {
          ...mockSession.changes[0],
          reason: "Fixed <vulnerability> in parser & validator"
        }
      ]
    };
    const result = renderSessionToHtml(sessionWithHtml, mockDiffs);
    expect(result).toContain("&lt;vulnerability&gt;");
    expect(result).toContain("&amp;");
  });

  it("should include required meta tags", () => {
    const result = renderSessionToHtml(mockSession, mockDiffs);
    expect(result).toContain('<meta charset="UTF-8">');
    expect(result).toContain('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
  });

  it("should embed an inline stylesheet rather than linking an external one", () => {
    const result = renderSessionToHtml(mockSession, mockDiffs);
    expect(result).toContain("<style>");
    expect(result).not.toContain("diff2html.min.css");
  });

  it("should include CSS variables for the dark theme", () => {
    const result = renderSessionToHtml(mockSession, mockDiffs);
    expect(result).toContain("--bg: #1a1a2e");
    expect(result).toContain("--fg: #eaeaea");
    expect(result).toContain("--accent: #4fc3f7");
    expect(result).toContain("--green: #66bb6a");
    expect(result).toContain("--red: #ef5350");
  });

  it("should use a centered container layout", () => {
    const result = renderSessionToHtml(mockSession, mockDiffs);
    expect(result).toContain('class="container"');
    expect(result).toContain("max-width: 960px");
  });

  it("should include the summary bar and reason groups", () => {
    const result = renderSessionToHtml(mockSession, mockDiffs);
    expect(result).toContain('class="summary-bar"');
    expect(result).toContain('class="summary-stat"');
    expect(result).toContain('class="reason-group"');
  });

  it("should handle empty changes array", () => {
    const emptySession: ReviewSession = {
      ...mockSession,
      total_changes: 0,
      files_changed: [],
      changes: []
    };
    const result = renderSessionToHtml(emptySession, []);
    expect(result).toContain('<div class="summary-stat"><strong>0</strong> changes</div>');
  });

  it("should apply correct change type CSS classes", () => {
    const result = renderSessionToHtml(mockSession, mockDiffs);
    expect(result).toContain("fn-badge-add");
    expect(result).toContain("fn-badge-modify");
    expect(result).toContain("fn-badge-delete");
  });

  it("should render side-by-side style without error", () => {
    const options: RenderOptions = {
      show_test_status: true,
      show_error_ids: true,
      style: "side-by-side"
    };
    const result = renderSessionToHtml(mockSession, mockDiffs, options);
    expect(result).toContain('class="diff-block"');
    expect(result.length).toBeGreaterThan(0);
  });

  it("should render line-by-line style without error", () => {
    const options: RenderOptions = {
      show_test_status: true,
      show_error_ids: true,
      style: "line-by-line"
    };
    const result = renderSessionToHtml(mockSession, mockDiffs, options);
    expect(result).toContain('class="diff-block"');
    expect(result.length).toBeGreaterThan(0);
  });

  it("should ignore raw diffs (rendered from change content, not unified diff text)", () => {
    const diffs = ["diff1", "diff2", "diff3"];
    const result = renderSessionToHtml(mockSession, diffs);
    // _rawDiffs is intentionally unused; inline content drives the diff blocks.
    expect(result).not.toContain("diff1\ndiff2\ndiff3");
    expect(result).toContain('class="diff-block"');
  });

  it("should render a change without an error_id field", () => {
    const sessionNoError: ReviewSession = {
      ...mockSession,
      total_changes: 1,
      files_changed: ["src/utils.ts"],
      changes: [
        {
          id: "c1",
          timestamp: "2024-01-15T10:30:00Z",
          file_path: "src/utils.ts",
          function_hash: "hash",
          function_name: "helper",
          class_name: null,
          change_type: "add",
          reason: "New helper function",
          reason_source: "context",
          old_content: null,
          new_content: "code",
          start_line: 1,
          end_line: 3,
          test_status: "pass",
          test_file: null,
          error_id: null,
          session_id: "session-123"
        }
      ]
    };
    const options: RenderOptions = {
      show_test_status: true,
      show_error_ids: true,
      style: "side-by-side"
    };
    const result = renderSessionToHtml(sessionNoError, mockDiffs, options);
    expect(result).toContain('class="fn-name">helper</span>');
    expect(result).toContain("New helper function");
  });

  it("should include reason group header elements", () => {
    const result = renderSessionToHtml(mockSession, mockDiffs);
    expect(result).toContain("reason-header");
    expect(result).toContain("reason-arrow");
    expect(result).toContain("reason-meta");
  });

  it("should include function item body elements", () => {
    const result = renderSessionToHtml(mockSession, mockDiffs);
    expect(result).toContain("fn-item");
    expect(result).toContain("fn-header");
    expect(result).toContain("fn-diff");
  });

  it("should use default options when none provided", () => {
    const result = renderSessionToHtml(mockSession, mockDiffs);
    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("should render the same file path once per reason group it appears in", () => {
    const result = renderSessionToHtml(mockSession, mockDiffs);
    // src/app.ts is referenced by two distinct reasons (modify + delete),
    // so it appears in the file-changed list plus each reason group's file section.
    const appTsCount = (result.match(/src\/app\.ts/g) || []).length;
    expect(appTsCount).toBeGreaterThan(1);
  });

  it("should render file paths in dedicated file-path elements", () => {
    const result = renderSessionToHtml(mockSession, mockDiffs);
    expect(result).toContain('class="file-path">src/app.ts</div>');
    expect(result).toContain('class="file-path">src/utils.ts</div>');
  });

  it("should render an ecl badge when ecl_context is present", () => {
    const sessionWithEcl: ReviewSession = {
      ...mockSession,
      changes: [
        {
          ...mockSession.changes[0],
          ecl_context: {
            feature: "auth-refactor",
            decisions: ["use-jwt"],
            ecl_file: "docs/ecl/auth.yaml"
          }
        }
      ]
    };
    const result = renderSessionToHtml(sessionWithEcl, mockDiffs);
    expect(result).toContain('class="ecl-badge"');
    expect(result).toContain("auth-refactor");
  });
});

describe("HTML Escaping - Indirect Tests via renderSessionToHtml", () => {
  function singleChangeSession(reason: string): ReviewSession {
    return {
      id: "test",
      timestamp: "2024-01-15T10:30:00Z",
      trigger: "hook",
      total_changes: 1,
      files_changed: ["file.ts"],
      summary: "Test",
      changes: [
        {
          id: "c1",
          timestamp: "2024-01-15T10:30:00Z",
          file_path: "file.ts",
          function_hash: "h1",
          function_name: "test",
          class_name: null,
          change_type: "add",
          reason,
          reason_source: "context",
          old_content: null,
          new_content: "code",
          start_line: 1,
          end_line: 5,
          test_status: "pass",
          test_file: null,
          error_id: null,
          session_id: "test"
        }
      ]
    };
  }

  it("should escape ampersand in change reason", () => {
    const result = renderSessionToHtml(singleChangeSession("Tom & Jerry"), []);
    expect(result).toContain("&amp;");
  });

  it("should escape less than and greater than in title", () => {
    const options: RenderOptions = {
      title: "a < b and c > d",
      show_test_status: true,
      show_error_ids: true,
      style: "side-by-side"
    };
    const result = renderSessionToHtml(singleChangeSession("Simple fix"), [], options);
    expect(result).toContain("&lt;");
    expect(result).toContain("&gt;");
  });

  it("should escape quotes in title", () => {
    const session: ReviewSession = {
      id: "test",
      timestamp: "2024-01-15T10:30:00Z",
      trigger: "hook",
      total_changes: 0,
      files_changed: [],
      summary: "Test",
      changes: []
    };
    const options: RenderOptions = {
      title: 'He said "hello"',
      show_test_status: true,
      show_error_ids: true,
      style: "side-by-side"
    };
    const result = renderSessionToHtml(session, [], options);
    expect(result).toContain("&quot;");
  });

  it("should prevent XSS through title", () => {
    const session: ReviewSession = {
      id: "test",
      timestamp: "2024-01-15T10:30:00Z",
      trigger: "hook",
      total_changes: 0,
      files_changed: [],
      summary: "Test",
      changes: []
    };
    const options: RenderOptions = {
      title: '<img src="x">',
      show_test_status: true,
      show_error_ids: true,
      style: "side-by-side"
    };
    const result = renderSessionToHtml(session, [], options);
    expect(result).not.toContain('<img src="x">');
    expect(result).toContain("&lt;img");
    expect(result).toContain("&quot;");
  });
});
