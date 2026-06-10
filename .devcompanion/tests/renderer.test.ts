import { describe, it, expect } from "vitest";
import { renderSessionToHtml } from "../../packages/render/src/renderer.js";
import type { ReviewSession, ChangeRecord } from "@aidev/history";

function makeChangeRecord(overrides?: Partial<ChangeRecord>): ChangeRecord {
  return {
    id: "change-1",
    timestamp: "2026-01-15T10:00:00Z",
    file_path: "src/utils.ts",
    function_hash: "hash123",
    function_name: "processData",
    class_name: null,
    change_type: "modify",
    reason: "Improved performance by adding caching",
    reason_source: "llm-inferred",
    old_content: "function processData() { return data; }",
    new_content: "function processData() { return cached ? cache : data; }",
    start_line: 10,
    end_line: 15,
    test_status: "pass",
    test_file: "src/utils.test.ts",
    error_id: null,
    session_id: "session-1",
    ...overrides,
  };
}

function makeReviewSession(overrides?: Partial<ReviewSession>): ReviewSession {
  return {
    id: "session-1",
    timestamp: "2026-01-15T10:00:00Z",
    trigger: "hook",
    summary: "Code improvements for performance and maintainability",
    total_changes: 3,
    files_changed: ["src/utils.ts", "src/helpers.ts"],
    changes: [
      makeChangeRecord({ id: "change-1", file_path: "src/utils.ts" }),
      makeChangeRecord({ id: "change-2", file_path: "src/helpers.ts", change_type: "add" }),
      makeChangeRecord({ id: "change-3", file_path: "src/utils.ts", change_type: "delete" }),
    ],
    ...overrides,
  };
}

describe("renderSessionToHtml", () => {
  it("should execute without throwing", () => {
    const session = makeReviewSession();
    const rawDiffs = ["--- a/src/utils.ts", "+++ b/src/utils.ts"];
    expect(() => renderSessionToHtml(session, rawDiffs)).not.toThrow();
  });

  it("should return a string", () => {
    const session = makeReviewSession();
    const result = renderSessionToHtml(session, ["diff"]);
    expect(typeof result).toBe("string");
  });

  it("should return valid HTML document", () => {
    const session = makeReviewSession();
    const result = renderSessionToHtml(session, ["diff"]);
    expect(result).toMatch(/^<!DOCTYPE html>/);
    expect(result).toContain("</html>");
  });

  it("should use custom title", () => {
    const session = makeReviewSession();
    const result = renderSessionToHtml(session, ["diff"], {
      show_test_status: true,
      show_error_ids: true,
      style: "side-by-side",
      title: "Custom Review",
    });
    expect(result).toContain("Custom Review");
  });

  it("should use default title with timestamp", () => {
    const session = makeReviewSession({ timestamp: "2026-05-15T14:30:00Z" });
    const result = renderSessionToHtml(session, ["diff"], {
      show_test_status: true,
      show_error_ids: true,
      style: "side-by-side",
    });
    expect(result).toContain("Review: 2026-05-15T14:30:00Z");
  });

  it("should escape HTML in title", () => {
    const session = makeReviewSession();
    const result = renderSessionToHtml(session, ["diff"], {
      show_test_status: true,
      show_error_ids: true,
      style: "side-by-side",
      title: "<div>xss</div>",
    });
    expect(result).not.toContain("<div>");
    expect(result).toContain("&lt;div&gt;");
  });

  it("should include diff content", () => {
    const session = makeReviewSession();
    const result = renderSessionToHtml(session, ["diff line 1", "diff line 2"]);
    // Diffs are rendered inline from old_content/new_content into diff-block.
    expect(result).toContain("diff-block");
    expect(result).toContain("diff-add");
    expect(result).toContain("diff-del");
  });

  it("should include summary bar", () => {
    const session = makeReviewSession();
    const result = renderSessionToHtml(session, ["diff"]);
    expect(result).toContain("summary-bar");
    expect(result).toContain("summary-stat");
  });

  it("should display total changes and files", () => {
    const session = makeReviewSession({ total_changes: 5, files_changed: ["f1", "f2", "f3"] });
    const result = renderSessionToHtml(session, ["diff"]);
    expect(result).toContain("<strong>5</strong>");
    expect(result).toContain("<strong>3</strong>");
  });

  it("should display session summary", () => {
    const session = makeReviewSession({ summary: "Fixed critical bugs" });
    const result = renderSessionToHtml(session, ["diff"]);
    expect(result).toContain("Fixed critical bugs");
  });

  it("should list changed files with counts", () => {
    // Changes are grouped by reason; a group reports its total change count.
    const session = makeReviewSession({
      changes: [
        makeChangeRecord({ id: "1", file_path: "src/utils.ts", change_type: "modify", reason: "Refactor utils" }),
        makeChangeRecord({ id: "2", file_path: "src/utils.ts", change_type: "modify", reason: "Refactor utils" }),
        makeChangeRecord({ id: "3", file_path: "src/helpers.ts", change_type: "add", reason: "Add helper" }),
      ],
    });
    const result = renderSessionToHtml(session, ["diff"]);
    expect(result).toContain("src/utils.ts");
    // The "Refactor utils" reason group contains 2 changes; the lone group has 1.
    expect(result).toContain("2 changes");
    expect(result).toContain("1 change");
  });

  it("should render changes grouped by reason into file sections", () => {
    const session = makeReviewSession();
    const result = renderSessionToHtml(session, ["diff"]);
    // The old standalone "annotations panel" was replaced by reason-group/file-section/fn-item.
    expect(result).toContain("reason-group");
    expect(result).toContain("file-section");
    expect(result).toContain("fn-item");
  });

  it("should show all changes as function items", () => {
    const session = makeReviewSession({
      changes: [
        makeChangeRecord({ id: "1", function_name: "getData" }),
        makeChangeRecord({ id: "2", function_name: "processData" }),
      ],
    });
    const result = renderSessionToHtml(session, ["diff"]);
    // Per-change "#N" indices were removed; each change renders as an fn-item with its fn-name.
    expect(result).toContain('class="fn-name">getData');
    expect(result).toContain('class="fn-name">processData');
  });

  it("should display change types", () => {
    const session = makeReviewSession({
      changes: [
        makeChangeRecord({ id: "1", change_type: "add" }),
        makeChangeRecord({ id: "2", change_type: "modify" }),
        makeChangeRecord({ id: "3", change_type: "delete" }),
      ],
    });
    const result = renderSessionToHtml(session, ["diff"]);
    expect(result).toContain("fn-badge-add");
    expect(result).toContain("fn-badge-modify");
    expect(result).toContain("fn-badge-delete");
  });

  // NOTE: The renderer still accepts `show_test_status`, but the current
  // implementation emits no test-status badge markup at all (the per-change
  // pass/fail badge feature was removed in the refactor). These tests now
  // assert the option is honored as a no-op rather than the dead markup.
  it("should accept show_test_status without emitting test badges", () => {
    const session = makeReviewSession({
      changes: [
        makeChangeRecord({ id: "1", test_status: "pass" }),
        makeChangeRecord({ id: "2", test_status: "fail" }),
      ],
    });
    const result = renderSessionToHtml(session, ["diff"], {
      show_test_status: true,
      show_error_ids: true,
      style: "side-by-side",
    });
    expect(result).not.toContain("badge-pass");
    expect(result).not.toContain("badge-fail");
  });

  it("should produce identical output regardless of show_test_status", () => {
    const session = makeReviewSession({
      changes: [makeChangeRecord({ id: "1", test_status: "pass" })],
    });
    const enabled = renderSessionToHtml(session, ["diff"], {
      show_test_status: true,
      show_error_ids: true,
      style: "side-by-side",
    });
    const disabled = renderSessionToHtml(session, ["diff"], {
      show_test_status: false,
      show_error_ids: true,
      style: "side-by-side",
    });
    expect(disabled).toBe(enabled);
  });

  // NOTE: The per-change error_id badge feature was also removed; the renderer
  // accepts `show_error_ids` but does not render error ids in the output.
  it("should accept show_error_ids without emitting error badges", () => {
    const session = makeReviewSession({
      changes: [makeChangeRecord({ id: "1", error_id: "ERR-123" })],
    });
    const result = renderSessionToHtml(session, ["diff"], {
      show_test_status: true,
      show_error_ids: true,
      style: "side-by-side",
    });
    expect(result).not.toContain("badge-error");
    expect(result).not.toContain("ERR-123");
  });

  it("should produce identical output regardless of show_error_ids", () => {
    const session = makeReviewSession({
      changes: [makeChangeRecord({ id: "1", error_id: "ERR-123" })],
    });
    const enabled = renderSessionToHtml(session, ["diff"], {
      show_test_status: true,
      show_error_ids: true,
      style: "side-by-side",
    });
    const disabled = renderSessionToHtml(session, ["diff"], {
      show_test_status: true,
      show_error_ids: false,
      style: "side-by-side",
    });
    expect(disabled).toBe(enabled);
  });

  it("should display change reasons", () => {
    const session = makeReviewSession({
      changes: [makeChangeRecord({ id: "1", reason: "Fixed critical bug" })],
    });
    const result = renderSessionToHtml(session, ["diff"]);
    expect(result).toContain("Fixed critical bug");
  });

  it("should escape HTML in reasons", () => {
    const session = makeReviewSession({
      changes: [makeChangeRecord({ id: "1", reason: "Fixed <XSS> bug" })],
    });
    const result = renderSessionToHtml(session, ["diff"]);
    expect(result).not.toContain("<XSS>");
    expect(result).toContain("&lt;XSS&gt;");
  });

  it("should display reason sources", () => {
    // Reason source is displayed per reason group, so give each change a
    // distinct reason to keep them in separate groups.
    const session = makeReviewSession({
      changes: [
        makeChangeRecord({ id: "1", reason: "From context", reason_source: "context" }),
        makeChangeRecord({ id: "2", reason: "Inferred", reason_source: "llm-inferred" }),
      ],
    });
    const result = renderSessionToHtml(session, ["diff"]);
    // Reason source is shown in reason-meta as "&middot; <source>" (no parentheses).
    expect(result).toContain("&middot; context");
    expect(result).toContain("&middot; llm-inferred");
  });

  it("should display file paths and line ranges", () => {
    const session = makeReviewSession({
      changes: [makeChangeRecord({ id: "1", start_line: 42, end_line: 58, file_path: "src/api.ts" })],
    });
    const result = renderSessionToHtml(session, ["diff"]);
    // Line ranges render as "L<start>–<end>" in the fn-lines span.
    expect(result).toContain("L42");
    expect(result).toContain("src/api.ts");
  });

  it("should include CSS custom properties", () => {
    const session = makeReviewSession();
    const result = renderSessionToHtml(session, ["diff"]);
    expect(result).toContain("--bg:");
    expect(result).toContain("--accent:");
  });

  it("should inline its CSS instead of linking an external stylesheet", () => {
    const session = makeReviewSession();
    const result = renderSessionToHtml(session, ["diff"]);
    // The external diff2html stylesheet link was removed; all CSS is now inline.
    expect(result).not.toContain("diff2html");
    expect(result).not.toContain("<link");
    expect(result).toContain("<style>");
  });

  it("should have HTML structure", () => {
    const session = makeReviewSession();
    const result = renderSessionToHtml(session, ["diff"]);
    expect(result).toContain("<head>");
    expect(result).toContain("</head>");
    expect(result).toContain("<body>");
  });

  it("should handle empty changes", () => {
    const session = makeReviewSession({ changes: [], total_changes: 0 });
    const result = renderSessionToHtml(session, []);
    expect(result).toContain("summary-bar");
    expect(result).toContain("<strong>0</strong> changes");
  });

  it("should support side-by-side style", () => {
    const session = makeReviewSession();
    expect(() =>
      renderSessionToHtml(session, ["diff"], {
        show_test_status: true,
        show_error_ids: true,
        style: "side-by-side",
      })
    ).not.toThrow();
  });

  it("should support line-by-line style", () => {
    const session = makeReviewSession();
    expect(() =>
      renderSessionToHtml(session, ["diff"], {
        show_test_status: true,
        show_error_ids: true,
        style: "line-by-line",
      })
    ).not.toThrow();
  });

  it("should work with default options", () => {
    const session = makeReviewSession();
    const result = renderSessionToHtml(session, ["diff"]);
    expect(result).toBeDefined();
  });

  it("should handle many changes", () => {
    const changes = Array.from({ length: 50 }, (_, i) =>
      makeChangeRecord({ id: `c${i}`, file_path: `src/file${i % 5}.ts` })
    );
    const session = makeReviewSession({ changes, total_changes: 50 });
    expect(() => renderSessionToHtml(session, ["diff"])).not.toThrow();
  });

  it("should include lang attribute", () => {
    const session = makeReviewSession();
    const result = renderSessionToHtml(session, ["diff"]);
    expect(result).toContain('lang="en"');
  });
});
