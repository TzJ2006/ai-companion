import { describe, it, expect, beforeEach } from "vitest";
import type { ReviewSession } from "@aidev/history";

import { renderSessionToHtml, type RenderOptions } from "../../packages/render/src/renderer.js";

describe("renderSessionToHtml", () => {
  let session: ReviewSession;

  beforeEach(() => {
    session = {
      id: "s1",
      timestamp: "2024-01-15T10:30:00Z",
      trigger: "hook",
      total_changes: 2,
      files_changed: ["src/app.ts", "src/utils.ts"],
      summary: "Updated logic",
      changes: [
        {
          id: "c1",
          timestamp: "2024-01-15T10:30:00Z",
          file_path: "src/app.ts",
          function_hash: "h1",
          function_name: "initApp",
          class_name: null,
          change_type: "modify",
          reason: "Refactored init",
          reason_source: "context",
          old_content: "old",
          new_content: "new",
          start_line: 10,
          end_line: 25,
          test_status: "pass",
          test_file: "test.ts",
          error_id: null,
          session_id: "s1"
        },
        {
          id: "c2",
          timestamp: "2024-01-15T10:30:00Z",
          file_path: "src/utils.ts",
          function_hash: "h2",
          function_name: "parseData",
          class_name: null,
          change_type: "add",
          reason: "Added utility",
          reason_source: "llm-inferred",
          old_content: null,
          new_content: "code",
          start_line: 5,
          end_line: 8,
          test_status: "fail",
          test_file: null,
          error_id: "101",
          session_id: "s1"
        }
      ]
    };
  });

  it("should generate valid HTML5 document", () => {
    const result = renderSessionToHtml(session, []);
    expect(result).toContain("<!DOCTYPE html>");
    expect(result).toContain('<html lang="en">');
    expect(result).toContain("</html>");
  });

  it("should include charset meta tag", () => {
    const result = renderSessionToHtml(session, []);
    expect(result).toContain('<meta charset="UTF-8">');
  });

  it("should include viewport meta tag", () => {
    const result = renderSessionToHtml(session, []);
    expect(result).toContain('viewport');
  });

  it("should embed an inline stylesheet rather than an external link", () => {
    const result = renderSessionToHtml(session, []);
    // Renderer now ships an inline <style> block; the old external
    // diff2html.min.css link no longer exists.
    expect(result).toContain("<style>");
    expect(result).not.toContain("diff2html.min.css");
  });

  it("should use session timestamp as default title", () => {
    const result = renderSessionToHtml(session, []);
    expect(result).toContain("Review: 2024-01-15T10:30:00Z");
  });

  it("should use custom title when provided", () => {
    const opts: RenderOptions = {
      title: "Security Review",
      show_test_status: true,
      show_error_ids: true,
      style: "side-by-side"
    };
    const result = renderSessionToHtml(session, [], opts);
    expect(result).toContain("<title>Security Review</title>");
    expect(result).toContain("Security Review");
  });

  it("should escape HTML entities in title", () => {
    const opts: RenderOptions = {
      title: "<script>alert('xss')</script>",
      show_test_status: true,
      show_error_ids: true,
      style: "side-by-side"
    };
    const result = renderSessionToHtml(session, [], opts);
    expect(result).not.toContain("<title><script>");
    expect(result).toContain("&lt;script&gt;");
  });

  it("should display summary bar", () => {
    const result = renderSessionToHtml(session, []);
    expect(result).toContain("summary-bar");
    expect(result).toContain("summary-stat");
  });

  it("should display total changes count", () => {
    const result = renderSessionToHtml(session, []);
    expect(result).toContain("<strong>2</strong> changes");
  });

  it("should display files changed count", () => {
    const result = renderSessionToHtml(session, []);
    expect(result).toContain("<strong>2</strong> files");
  });

  it("should list all changed files", () => {
    const result = renderSessionToHtml(session, []);
    expect(result).toContain("src/app.ts");
    expect(result).toContain("src/utils.ts");
  });

  it("should group changes by reason", () => {
    const result = renderSessionToHtml(session, []);
    expect(result).toContain("reason-group");
    expect(result).toContain("reason-header");
  });

  it("should render a function item per change", () => {
    const result = renderSessionToHtml(session, []);
    const count = (result.match(/fn-item/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("should render reason groups for each distinct reason", () => {
    const result = renderSessionToHtml(session, []);
    const count = (result.match(/class="reason-group"/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("should display function names", () => {
    const result = renderSessionToHtml(session, []);
    expect(result).toContain("initApp");
    expect(result).toContain("parseData");
  });

  it("should display change types as function badges", () => {
    const result = renderSessionToHtml(session, []);
    expect(result).toContain("fn-badge-modify");
    expect(result).toContain("fn-badge-add");
  });

  it("should include function navigation ids per change", () => {
    const result = renderSessionToHtml(session, []);
    // Each function item is addressable via fn-<hash>-<startLine>.
    expect(result).toContain('id="fn-h1-10"');
    expect(result).toContain('id="arrow-fn-h1-10"');
  });

  it("should display line number ranges", () => {
    const result = renderSessionToHtml(session, []);
    expect(result).toContain("L10–25");
    expect(result).toContain("L5–8");
  });

  it("should display change reasons", () => {
    const result = renderSessionToHtml(session, []);
    expect(result).toContain("Refactored init");
    expect(result).toContain("Added utility");
  });

  it("should display reason sources", () => {
    const result = renderSessionToHtml(session, []);
    expect(result).toContain("context");
    expect(result).toContain("llm-inferred");
  });

  it("should render deleted lines from old content", () => {
    const opts: RenderOptions = {
      show_test_status: true,
      show_error_ids: false,
      style: "side-by-side"
    };
    const result = renderSessionToHtml(session, [], opts);
    expect(result).toContain("diff-del");
  });

  it("should render added lines from new content", () => {
    const opts: RenderOptions = {
      show_test_status: true,
      show_error_ids: false,
      style: "side-by-side"
    };
    const result = renderSessionToHtml(session, [], opts);
    expect(result).toContain("diff-add");
  });

  it("should render diff blocks for changes with content", () => {
    const opts: RenderOptions = {
      show_test_status: false,
      show_error_ids: true,
      style: "side-by-side"
    };
    const result = renderSessionToHtml(session, [], opts);
    expect(result).toContain("diff-block");
  });

  it("should render an empty-diff placeholder when no content is present", () => {
    const noContent: ReviewSession = {
      ...session,
      changes: [{ ...session.changes[0], old_content: null, new_content: null }]
    };
    const result = renderSessionToHtml(noContent, []);
    expect(result).toContain("diff-empty");
    expect(result).toContain("No diff content available");
  });

  it("should escape diff content lines", () => {
    const withHtml: ReviewSession = {
      ...session,
      changes: [{ ...session.changes[0], new_content: "<b>danger</b>" }]
    };
    const result = renderSessionToHtml(withHtml, []);
    expect(result).toContain("&lt;b&gt;danger&lt;/b&gt;");
  });

  it("should render diff signs for added and removed lines", () => {
    const result = renderSessionToHtml(session, []);
    expect(result).toContain('class="diff-sign"');
  });

  it("should render inline diff markup independent of style option", () => {
    const opts: RenderOptions = {
      show_test_status: true,
      show_error_ids: true,
      style: "line-by-line"
    };
    const result = renderSessionToHtml(session, [], opts);
    expect(result).toContain("diff-block");
    expect(result).toContain("diff-add");
  });

  it("should ignore the rawDiffs argument", () => {
    // Inline diffs come from change records, not the rawDiffs slot.
    const withDiffs = renderSessionToHtml(session, ["diff1", "diff2"]);
    const withoutDiffs = renderSessionToHtml(session, []);
    expect(withDiffs).toBe(withoutDiffs);
  });

  it("should handle empty changes array", () => {
    const empty: ReviewSession = { ...session, total_changes: 0, changes: [] };
    const result = renderSessionToHtml(empty, []);
    expect(result).toContain("<strong>0</strong>");
  });

  it("should handle empty diffs array", () => {
    const result = renderSessionToHtml(session, []);
    expect(result).toBeDefined();
  });

  it("should contain HTML structure regardless of summary", () => {
    const withHtml: ReviewSession = { ...session, summary: "<script>alert('xss')</script>" };
    const result = renderSessionToHtml(withHtml, []);
    expect(result).toContain("<!DOCTYPE html>");
    expect(result).toContain("summary-bar");
  });

  it("should escape HTML in change reasons", () => {
    const withHtml: ReviewSession = {
      ...session,
      changes: [{ ...session.changes[0], reason: "Fixed <vulnerability>" }]
    };
    const result = renderSessionToHtml(withHtml, []);
    expect(result).toContain("&lt;vulnerability&gt;");
  });

  it("should include CSS variables for dark theme", () => {
    const result = renderSessionToHtml(session, []);
    expect(result).toContain("--bg: #1a1a2e");
    expect(result).toContain("--accent: #4fc3f7");
    expect(result).toContain("--green: #66bb6a");
    expect(result).toContain("--red: #ef5350");
  });

  it("should include change type styling classes", () => {
    const result = renderSessionToHtml(session, []);
    expect(result).toContain(".fn-badge-add");
    expect(result).toContain(".fn-badge-modify");
  });

  it("should include diff styling classes", () => {
    const result = renderSessionToHtml(session, []);
    expect(result).toContain(".diff-add");
    expect(result).toContain(".diff-del");
    expect(result).toContain(".diff-empty");
  });

  it("should render an ECL badge when ecl_context is present", () => {
    const withEcl: ReviewSession = {
      ...session,
      changes: [
        {
          ...session.changes[0],
          ecl_context: {
            feature: "ecl-context-linking",
            decisions: ["DEC-001"],
            ecl_file: "docs/ecl/ecl-context-linking.yaml"
          }
        }
      ]
    };
    const result = renderSessionToHtml(withEcl, []);
    expect(result).toContain("ecl-badge");
    expect(result).toContain("ecl-context-linking");
    expect(result).toContain("DEC-001");
  });

  it("should return a string", () => {
    const result = renderSessionToHtml(session, []);
    expect(typeof result).toBe("string");
  });

  it("should return non-empty string", () => {
    const result = renderSessionToHtml(session, []);
    expect(result.length).toBeGreaterThan(0);
  });

  it("should return valid HTML document", () => {
    const result = renderSessionToHtml(session, []);
    expect(result).toMatch(/^<!DOCTYPE html>/i);
    expect(result).toMatch(/<\/html>$/i);
  });
});

describe("Integration - Multiple Files", () => {
  it("should aggregate changes from multiple files", () => {
    const session: ReviewSession = {
      id: "s1",
      timestamp: "2024-01-15T10:30:00Z",
      trigger: "hook",
      total_changes: 3,
      files_changed: ["file1.ts", "file2.ts", "file3.ts"],
      summary: "Multi-file update",
      changes: [
        {
          id: "c1",
          timestamp: "2024-01-15T10:30:00Z",
          file_path: "file1.ts",
          function_hash: "h1",
          function_name: "fn1",
          class_name: null,
          change_type: "add",
          reason: "Added",
          reason_source: "context",
          old_content: null,
          new_content: "code",
          start_line: 1,
          end_line: 5,
          test_status: "pass",
          test_file: null,
          error_id: null,
          session_id: "s1"
        },
        {
          id: "c2",
          timestamp: "2024-01-15T10:30:00Z",
          file_path: "file2.ts",
          function_hash: "h2",
          function_name: "fn2",
          class_name: null,
          change_type: "modify",
          reason: "Modified",
          reason_source: "context",
          old_content: "old",
          new_content: "new",
          start_line: 10,
          end_line: 15,
          test_status: "fail",
          test_file: null,
          error_id: null,
          session_id: "s1"
        },
        {
          id: "c3",
          timestamp: "2024-01-15T10:30:00Z",
          file_path: "file3.ts",
          function_hash: "h3",
          function_name: "fn3",
          class_name: null,
          change_type: "delete",
          reason: "Deleted",
          reason_source: "context",
          old_content: "code",
          new_content: null,
          start_line: 20,
          end_line: 25,
          test_status: "pending",
          test_file: null,
          error_id: null,
          session_id: "s1"
        }
      ]
    };
    const result = renderSessionToHtml(session, []);
    expect(result).toContain("file1.ts");
    expect(result).toContain("file2.ts");
    expect(result).toContain("file3.ts");
  });

  it("should render badges for each change type", () => {
    const session: ReviewSession = {
      id: "s1",
      timestamp: "2024-01-15T10:30:00Z",
      trigger: "cli",
      total_changes: 3,
      files_changed: ["file.ts"],
      summary: "Various changes",
      changes: [
        {
          id: "c1",
          timestamp: "2024-01-15T10:30:00Z",
          file_path: "file.ts",
          function_hash: "h1",
          function_name: "fn1",
          class_name: null,
          change_type: "add",
          reason: "Added fn",
          reason_source: "context",
          old_content: null,
          new_content: "new",
          start_line: 1,
          end_line: 5,
          test_status: "pass",
          test_file: null,
          error_id: null,
          session_id: "s1"
        },
        {
          id: "c2",
          timestamp: "2024-01-15T10:30:00Z",
          file_path: "file.ts",
          function_hash: "h2",
          function_name: "fn2",
          class_name: null,
          change_type: "modify",
          reason: "Modified fn",
          reason_source: "context",
          old_content: "old",
          new_content: "new",
          start_line: 10,
          end_line: 15,
          test_status: "pending",
          test_file: null,
          error_id: null,
          session_id: "s1"
        },
        {
          id: "c3",
          timestamp: "2024-01-15T10:30:00Z",
          file_path: "file.ts",
          function_hash: "h3",
          function_name: "fn3",
          class_name: null,
          change_type: "delete",
          reason: "Deleted fn",
          reason_source: "context",
          old_content: "old",
          new_content: null,
          start_line: 20,
          end_line: 25,
          test_status: "fail",
          test_file: null,
          error_id: null,
          session_id: "s1"
        }
      ]
    };
    const opts: RenderOptions = {
      show_test_status: true,
      show_error_ids: false,
      style: "side-by-side"
    };
    const result = renderSessionToHtml(session, [], opts);
    expect(result).toContain("fn-badge-add");
    expect(result).toContain("fn-badge-modify");
    expect(result).toContain("fn-badge-delete");
  });
});
