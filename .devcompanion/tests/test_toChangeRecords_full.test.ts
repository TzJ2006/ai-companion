import { describe, it, expect, vi } from "vitest";

vi.mock("@aidev/ast", () => ({
  computeFunctionIdentity: vi.fn(),
}));

vi.mock("@aidev/history", () => ({}));

vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "test-uuid-1234"),
}));

import { toChangeRecords } from "../../packages/core/src/diff/annotator.js";
import type { AnnotatedChange } from "../../packages/core/src/diff/annotator.js";
import type { DiffHunk } from "../../packages/core/src/diff/parser.js";

function makeHunk(overrides: Partial<DiffHunk> = {}): DiffHunk {
  return {
    old_start: 1,
    old_count: 5,
    new_start: 1,
    new_count: 7,
    lines: [
      { type: "delete", content: "old line", old_line: 1, new_line: null },
      { type: "add", content: "new line", old_line: null, new_line: 1 },
      { type: "context", content: "unchanged", old_line: 2, new_line: 2 },
    ],
    ...overrides,
  };
}

function makeAnnotation(overrides: Partial<AnnotatedChange> = {}): AnnotatedChange {
  return {
    file_path: "src/utils.ts",
    function_name: "doSomething",
    function_hash: "abc123def456",
    class_name: null,
    change_type: "modify",
    reason: "refactor for clarity",
    reason_source: "user-provided",
    hunks: [makeHunk()],
    start_line: 10,
    end_line: 20,
    ...overrides,
  };
}

describe("toChangeRecords", () => {
  it("should execute without throwing", () => {
    const result = toChangeRecords([], "test-sessionId");
    expect(result).toBeDefined();
  });

  it("should return correct type (ChangeRecord[])", () => {
    const result = toChangeRecords([], "test-sessionId");
    expect(Array.isArray(result)).toBe(true);
  });

  it("should return empty array for empty annotations", () => {
    const result = toChangeRecords([], "session-123");
    expect(result).toEqual([]);
  });
  it("should convert single annotation to change record with all required fields", () => {
    const annotation = makeAnnotation({
      file_path: "src/index.ts",
      function_name: "main",
      function_hash: "hash-main-001",
      class_name: null,
      change_type: "add",
      reason: "initial implementation",
      reason_source: "context",
      start_line: 1,
      end_line: 50,
    });

    const records = toChangeRecords([annotation], "session-abc");

    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.id).toBe("test-uuid-1234");
    expect(record.file_path).toBe("src/index.ts");
    expect(record.function_hash).toBe("hash-main-001");
    expect(record.function_name).toBe("main");
    expect(record.class_name).toBeNull();
    expect(record.change_type).toBe("add");
    expect(record.reason).toBe("initial implementation");
    expect(record.reason_source).toBe("context");
    expect(record.session_id).toBe("session-abc");
  });
  it("should set test_status to pending", () => {
    const records = toChangeRecords([makeAnnotation()], "session");
    records.forEach((record) => {
      expect(record.test_status).toBe("pending");
    });
  });

  it("should set test_file to null", () => {
    const records = toChangeRecords([makeAnnotation()], "session");
    records.forEach((record) => {
      expect(record.test_file).toBeNull();
    });
  });

  it("should set error_id to null", () => {
    const records = toChangeRecords([makeAnnotation()], "session");
    records.forEach((record) => {
      expect(record.error_id).toBeNull();
    });
  });

  it("should preserve session_id across all records", () => {
    const annotations = [
      makeAnnotation({ function_name: "fn1" }),
      makeAnnotation({ function_name: "fn2" }),
      makeAnnotation({ function_name: "fn3" }),
    ];
    const sessionId = "important-session-xyz";
    const records = toChangeRecords(annotations, sessionId);
    records.forEach((record) => {
      expect(record.session_id).toBe(sessionId);
    });
  });
  it("should generate valid ISO 8601 timestamp", () => {
    const records = toChangeRecords([makeAnnotation()], "session");
    const timestamp = records[0].timestamp;
    expect(new Date(timestamp).toISOString()).toBe(timestamp);
  });

  it("should extract old_content from delete lines", () => {
    const hunk = makeHunk({
      lines: [
        { type: "delete", content: "removed line 1", old_line: 1, new_line: null },
        { type: "delete", content: "removed line 2", old_line: 2, new_line: null },
        { type: "add", content: "added line", old_line: null, new_line: 1 },
      ],
    });
    const annotation = makeAnnotation({ hunks: [hunk] });
    const records = toChangeRecords([annotation], "session");
    expect(records[0].old_content).toBe("removed line 1\nremoved line 2");
  });

  it("should extract new_content from add lines", () => {
    const hunk = makeHunk({
      lines: [
        { type: "delete", content: "old", old_line: 1, new_line: null },
        { type: "add", content: "new line 1", old_line: null, new_line: 1 },
        { type: "add", content: "new line 2", old_line: null, new_line: 2 },
      ],
    });
    const annotation = makeAnnotation({ hunks: [hunk] });
    const records = toChangeRecords([annotation], "session");
    expect(records[0].new_content).toBe("new line 1\nnew line 2");
  });
  it("should handle hunks with only context lines", () => {
    const hunk = makeHunk({
      lines: [
        { type: "context", content: "unchanged 1", old_line: 1, new_line: 1 },
        { type: "context", content: "unchanged 2", old_line: 2, new_line: 2 },
      ],
    });
    const annotation = makeAnnotation({ hunks: [hunk] });
    const records = toChangeRecords([annotation], "session");
    expect(records[0].old_content).toBe("");
    expect(records[0].new_content).toBe("");
  });

  it("should handle multiple hunks combining contents", () => {
    const hunk1 = makeHunk({
      lines: [
        { type: "delete", content: "old content 1", old_line: 1, new_line: null },
        { type: "add", content: "new content 1", old_line: null, new_line: 1 },
      ],
    });
    const hunk2 = makeHunk({
      lines: [
        { type: "delete", content: "old content 2", old_line: 5, new_line: null },
        { type: "add", content: "new content 2", old_line: null, new_line: 5 },
      ],
    });
    const annotation = makeAnnotation({ hunks: [hunk1, hunk2] });
    const records = toChangeRecords([annotation], "session");
    expect(records[0].old_content).toBe("old content 1\nold content 2");
    expect(records[0].new_content).toBe("new content 1\nnew content 2");
  });
  it("should preserve class_name when provided", () => {
    const annotation = makeAnnotation({
      function_name: "render",
      class_name: "MyComponent",
    });
    const records = toChangeRecords([annotation], "session");
    expect(records[0].function_name).toBe("render");
    expect(records[0].class_name).toBe("MyComponent");
  });

  it("should handle multiple annotations", () => {
    const annotations = [
      makeAnnotation({
        file_path: "src/a.ts",
        function_name: "funcA",
        function_hash: "hash-a",
      }),
      makeAnnotation({
        file_path: "src/b.ts",
        function_name: "funcB",
        function_hash: "hash-b",
      }),
      makeAnnotation({
        file_path: "src/c.ts",
        function_name: "funcC",
        function_hash: "hash-c",
      }),
    ];
    const records = toChangeRecords(annotations, "session");
    expect(records).toHaveLength(3);
    expect(records[0].file_path).toBe("src/a.ts");
    expect(records[1].file_path).toBe("src/b.ts");
    expect(records[2].file_path).toBe("src/c.ts");
  });
  it("should map all change_type values", () => {
    const changeTypes: Array<"add" | "modify" | "delete" | "rename"> = [
      "add",
      "modify",
      "delete",
      "rename",
    ];
    changeTypes.forEach((type) => {
      const annotation = makeAnnotation({ change_type: type });
      const records = toChangeRecords([annotation], "session");
      expect(records[0].change_type).toBe(type);
    });
  });

  it("should map all reason_source values", () => {
    const reasonSources: Array<"context" | "llm-inferred" | "user-provided"> = [
      "context",
      "llm-inferred",
      "user-provided",
    ];
    reasonSources.forEach((source) => {
      const annotation = makeAnnotation({ reason_source: source });
      const records = toChangeRecords([annotation], "session");
      expect(records[0].reason_source).toBe(source);
    });
  });
  it("should preserve start_line and end_line", () => {
    const annotation = makeAnnotation({
      start_line: 42,
      end_line: 100,
    });
    const records = toChangeRecords([annotation], "session");
    expect(records[0].start_line).toBe(42);
    expect(records[0].end_line).toBe(100);
  });

  it("should handle module-level changes", () => {
    const annotation = makeAnnotation({
      function_name: "<module-level>",
      function_hash: "module::src/utils.ts",
      class_name: null,
    });
    const records = toChangeRecords([annotation], "session");
    expect(records[0].function_name).toBe("<module-level>");
    expect(records[0].class_name).toBeNull();
  });

  it("should handle mixed content types in hunks", () => {
    const hunk = makeHunk({
      lines: [
        { type: "context", content: "stays", old_line: 1, new_line: 1 },
        { type: "delete", content: "goes away", old_line: 2, new_line: null },
        { type: "add", content: "arrives", old_line: null, new_line: 2 },
        { type: "context", content: "also stays", old_line: 3, new_line: 3 },
      ],
    });
    const annotation = makeAnnotation({ hunks: [hunk] });
    const records = toChangeRecords([annotation], "session");
    expect(records[0].old_content).toBe("goes away");
    expect(records[0].new_content).toBe("arrives");
  });
  it("should handle empty hunks array", () => {
    const annotation = makeAnnotation({ hunks: [] });
    const records = toChangeRecords([annotation], "session");
    expect(records[0].old_content).toBe("");
    expect(records[0].new_content).toBe("");
  });

  it("should not mutate input annotations", () => {
    const annotation = makeAnnotation();
    const annotations = [annotation];
    const originalLength = annotations.length;
    toChangeRecords(annotations, "session");
    expect(annotations).toHaveLength(originalLength);
  });

  it("should not mutate annotation objects", () => {
    const annotation = makeAnnotation({
      file_path: "src/test.ts",
      function_name: "test",
    });
    const originalFilePath = annotation.file_path;
    const originalFunctionName = annotation.function_name;
    toChangeRecords([annotation], "session");
    expect(annotation.file_path).toBe(originalFilePath);
    expect(annotation.function_name).toBe(originalFunctionName);
  });
  it("should preserve special characters in reason", () => {
    const specialReason = "fix: handle edge cases & refactor @deprecated";
    const annotation = makeAnnotation({ reason: specialReason });
    const records = toChangeRecords([annotation], "session");
    expect(records[0].reason).toBe(specialReason);
  });

  it("should handle long content in hunks", () => {
    const longContent = "x".repeat(1000);
    const hunk = makeHunk({
      lines: [
        { type: "delete", content: longContent, old_line: 1, new_line: null },
        { type: "add", content: longContent + "y", old_line: null, new_line: 1 },
      ],
    });
    const annotation = makeAnnotation({ hunks: [hunk] });
    const records = toChangeRecords([annotation], "session");
    expect(records[0].old_content).toBe(longContent);
    expect(records[0].new_content).toBe(longContent + "y");
  });

  it("should handle delete only hunks", () => {
    const hunk = makeHunk({
      lines: [
        { type: "delete", content: "deleted 1", old_line: 1, new_line: null },
        { type: "delete", content: "deleted 2", old_line: 2, new_line: null },
      ],
    });
    const annotation = makeAnnotation({ hunks: [hunk] });
    const records = toChangeRecords([annotation], "session");
    expect(records[0].old_content).toBe("deleted 1\ndeleted 2");
    expect(records[0].new_content).toBe("");
  });

  it("should handle add only hunks", () => {
    const hunk = makeHunk({
      lines: [
        { type: "add", content: "added 1", old_line: null, new_line: 1 },
        { type: "add", content: "added 2", old_line: null, new_line: 2 },
      ],
    });
    const annotation = makeAnnotation({ hunks: [hunk] });
    const records = toChangeRecords([annotation], "session");
    expect(records[0].old_content).toBe("");
    expect(records[0].new_content).toBe("added 1\nadded 2");
  });
});
