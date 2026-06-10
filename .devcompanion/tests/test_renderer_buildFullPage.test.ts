import { describe, it, expect } from "vitest";
import { renderSessionToHtml } from "../../packages/render/src/renderer.js";
import type { ReviewSession, ChangeRecord } from "@aidev/history";

const validChange: ChangeRecord = {
  id: "change-1",
  timestamp: "2026-06-02T00:00:00.000Z",
  file_path: "src/example.ts",
  function_hash: "abcdef0123456789",
  function_name: "exampleFunction",
  class_name: null,
  change_type: "modify",
  reason: "test-reason",
  reason_source: "user-provided",
  old_content: "const a = 1;",
  new_content: "const a = 2;",
  start_line: 1,
  end_line: 3,
  test_status: "pending",
  test_file: null,
  error_id: null,
  session_id: "session-1",
};

const validSession: ReviewSession = {
  id: "session-1",
  timestamp: "2026-06-02T00:00:00.000Z",
  trigger: "hook",
  summary: "test-summary",
  total_changes: 1,
  files_changed: ["src/example.ts"],
  changes: [validChange],
};

describe("renderSessionToHtml", () => {
  it("should execute without throwing", () => {
    const result = renderSessionToHtml(validSession, []);
    expect(result).toBeDefined();
  });

  it("should return correct type (string)", () => {
    const result = renderSessionToHtml(validSession, []);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
