import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@aidev/ast", () => ({
  computeFunctionIdentity: (filePath: string, fn: any) => ({
    hash: `hash_${fn.name}_${filePath}`,
    file_path: filePath,
    function_name: fn.name,
    class_name: fn.class_name,
    param_signature: fn.params.map((p: any) => p.type).join(","),
  }),
}));

vi.mock("node:crypto", () => ({
  randomUUID: () => "00000000-0000-0000-0000-000000000001",
}));

import {
  annotateChanges,
  toChangeRecords,
  deduplicateByFunction,
  extractNewContent,
} from "../../packages/core/src/diff/annotator.js";
import type {
  AnnotatedChange,
  AnnotationContext,
} from "../../packages/core/src/diff/annotator.js";
import type { FileDiff, DiffHunk, DiffLine } from "../../packages/core/src/diff/parser.js";
import type { FunctionSignature } from "@aidev/ast";

function makeDiffLine(type: DiffLine["type"], content: string): DiffLine {
  return {
    type,
    content,
    old_line: type === "delete" ? 1 : null,
    new_line: type === "add" ? 1 : null,
  };
}

function makeHunk(overrides: Partial<DiffHunk> = {}): DiffHunk {
  return {
    old_start: 1,
    old_count: 5,
    new_start: 1,
    new_count: 7,
    lines: [makeDiffLine("delete", "old line"), makeDiffLine("add", "new line")],
    ...overrides,
  };
}

function makeFileDiff(overrides: Partial<FileDiff> = {}): FileDiff {
  return {
    file_path: "src/utils.ts",
    old_path: null,
    status: "modified",
    hunks: [makeHunk()],
    raw_diff: "diff --git a/src/utils.ts b/src/utils.ts",
    ...overrides,
  };
}

function makeFunctionSig(overrides: Partial<FunctionSignature> = {}): FunctionSignature {
  return {
    name: "doSomething",
    params: [{ name: "x", type: "number", default_value: null, is_args: false, is_kwargs: false }],
    return_type: "void",
    decorators: [],
    is_method: false,
    is_async: false,
    class_name: null,
    start_line: 1,
    end_line: 20,
    docstring: null,
    ...overrides,
  };
}

function makeContext(overrides: Partial<AnnotationContext> = {}): AnnotationContext {
  return {
    reason: "Test reason",
    reason_source: "context",
    session_id: "test-session",
    ...overrides,
  };
}

function makeAnnotation(overrides: Partial<AnnotatedChange> = {}): AnnotatedChange {
  return {
    file_path: "src/utils.ts",
    function_name: "doSomething",
    function_hash: "abc123",
    class_name: null,
    change_type: "modify",
    reason: "refactor",
    reason_source: "context",
    hunks: [makeHunk()],
    start_line: 10,
    end_line: 20,
    ...overrides,
  };
}

describe("extractNewContent", () => {
  it("should return empty string for empty hunks array", () => {
    const result = extractNewContent([]);
    expect(result).toBe("");
  });

  it("should extract content from add lines only", () => {
    const hunk: DiffHunk = {
      old_start: 1,
      old_count: 0,
      new_start: 1,
      new_count: 3,
      lines: [
        { type: "add", content: "function foo() {", old_line: null, new_line: 1 },
        { type: "add", content: "  return 42;", old_line: null, new_line: 2 },
        { type: "add", content: "}", old_line: null, new_line: 3 },
      ],
    };

    const result = extractNewContent([hunk]);
    expect(result).toBe("function foo() {\n  return 42;\n}");
  });

  it("should ignore delete and context lines", () => {
    const hunk: DiffHunk = {
      old_start: 1,
      old_count: 2,
      new_start: 1,
      new_count: 2,
      lines: [
        { type: "delete", content: "old line", old_line: 1, new_line: null },
        { type: "add", content: "new line", old_line: null, new_line: 1 },
        { type: "context", content: "unchanged", old_line: 2, new_line: 2 },
      ],
    };

    const result = extractNewContent([hunk]);
    expect(result).toBe("new line");
  });

  it("should join multiple hunks with newline separator", () => {
    const hunk1: DiffHunk = {
      old_start: 1,
      old_count: 0,
      new_start: 1,
      new_count: 1,
      lines: [{ type: "add", content: "line1", old_line: null, new_line: 1 }],
    };

    const hunk2: DiffHunk = {
      old_start: 5,
      old_count: 0,
      new_start: 5,
      new_count: 1,
      lines: [{ type: "add", content: "line2", old_line: null, new_line: 5 }],
    };

    const result = extractNewContent([hunk1, hunk2]);
    expect(result).toBe("line1\nline2");
  });

  it("should handle hunks with no add lines", () => {
    const hunk: DiffHunk = {
      old_start: 1,
      old_count: 1,
      new_start: 1,
      new_count: 0,
      lines: [{ type: "delete", content: "removed", old_line: 1, new_line: null }],
    };

    const result = extractNewContent([hunk]);
    expect(result).toBe("");
  });

  it("should handle mixed add and context lines by extracting only adds", () => {
    const hunk: DiffHunk = {
      old_start: 1,
      old_count: 1,
      new_start: 1,
      new_count: 2,
      lines: [
        { type: "context", content: "existing code", old_line: 1, new_line: 1 },
        { type: "add", content: "new code", old_line: null, new_line: 2 },
      ],
    };

    const result = extractNewContent([hunk]);
    expect(result).toBe("new code");
  });

  it("should handle complex multi-hunk scenarios", () => {
    const hunks: DiffHunk[] = [
      {
        old_start: 1,
        old_count: 1,
        new_start: 1,
        new_count: 2,
        lines: [
          { type: "delete", content: "old", old_line: 1, new_line: null },
          { type: "add", content: "new1", old_line: null, new_line: 1 },
          { type: "add", content: "new2", old_line: null, new_line: 2 },
        ],
      },
      {
        old_start: 10,
        old_count: 1,
        new_start: 11,
        new_count: 1,
        lines: [
          { type: "context", content: "context line", old_line: 10, new_line: 11 },
          { type: "add", content: "new3", old_line: null, new_line: 12 },
        ],
      },
    ];

    const result = extractNewContent(hunks);
    expect(result).toBe("new1\nnew2\nnew3");
  });
});

describe("annotateChanges", () => {
  it("returns empty array for empty diffs", () => {
    const result = annotateChanges([], new Map(), makeContext());
    expect(result).toEqual([]);
  });

  it("creates module-level annotation when no functions overlap hunk", () => {
    const diff = makeFileDiff();
    const functionMap = new Map<string, FunctionSignature[]>();

    const result = annotateChanges([diff], functionMap, makeContext());

    expect(result).toHaveLength(1);
    expect(result[0].function_name).toBe("<module-level>");
    expect(result[0].function_hash).toBe("module::src/utils.ts");
    expect(result[0].class_name).toBeNull();
    expect(result[0].change_type).toBe("modify");
  });

  it("annotates function when hunk overlaps function range", () => {
    const diff = makeFileDiff();
    const fn = makeFunctionSig({ name: "calculate", start_line: 1, end_line: 10 });
    const functionMap = new Map([["src/utils.ts", [fn]]]);

    const result = annotateChanges([diff], functionMap, makeContext());

    expect(result).toHaveLength(1);
    expect(result[0].function_name).toBe("calculate");
    expect(result[0].function_hash).toBe("hash_calculate_src/utils.ts");
  });

  it("annotates multiple functions when hunk spans them", () => {
    const hunk = makeHunk({ new_start: 1, new_count: 30 });
    const diff = makeFileDiff({ hunks: [hunk] });
    const fn1 = makeFunctionSig({ name: "foo", start_line: 1, end_line: 10 });
    const fn2 = makeFunctionSig({ name: "bar", start_line: 15, end_line: 25 });
    const functionMap = new Map([["src/utils.ts", [fn1, fn2]]]);

    const result = annotateChanges([diff], functionMap, makeContext());

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.function_name)).toContain("foo");
    expect(result.map((r) => r.function_name)).toContain("bar");
  });

  it("deduplicates annotations for same function across hunks", () => {
    const hunk1 = makeHunk({ new_start: 2, new_count: 3 });
    const hunk2 = makeHunk({ new_start: 7, new_count: 2 });
    const diff = makeFileDiff({ hunks: [hunk1, hunk2] });
    const fn = makeFunctionSig({ name: "calculate", start_line: 1, end_line: 10 });
    const functionMap = new Map([["src/utils.ts", [fn]]]);

    const result = annotateChanges([diff], functionMap, makeContext());

    expect(result).toHaveLength(1);
    expect(result[0].hunks).toHaveLength(2);
  });

  it("infers add change_type for added files", () => {
    const diff = makeFileDiff({ status: "added" });
    const functionMap = new Map<string, FunctionSignature[]>();

    const result = annotateChanges([diff], functionMap, makeContext());

    expect(result[0].change_type).toBe("add");
  });

  it("infers delete change_type for deleted files", () => {
    const diff = makeFileDiff({ status: "deleted" });
    const functionMap = new Map<string, FunctionSignature[]>();

    const result = annotateChanges([diff], functionMap, makeContext());

    expect(result[0].change_type).toBe("delete");
  });

  it("infers rename change_type for renamed files", () => {
    const diff = makeFileDiff({ status: "renamed" });
    const functionMap = new Map<string, FunctionSignature[]>();

    const result = annotateChanges([diff], functionMap, makeContext());

    expect(result[0].change_type).toBe("rename");
  });

  it("handles class methods with class_name set", () => {
    const diff = makeFileDiff();
    const fn = makeFunctionSig({
      name: "do_work",
      class_name: "Worker",
      is_method: true,
      start_line: 1,
      end_line: 8,
    });
    const functionMap = new Map([["src/utils.ts", [fn]]]);

    const result = annotateChanges([diff], functionMap, makeContext());

    expect(result[0].class_name).toBe("Worker");
  });

  it("preserves context reason and reason_source", () => {
    const diff = makeFileDiff();
    const ctx = makeContext({
      reason: "Important refactor",
      reason_source: "user-provided",
    });
    const functionMap = new Map<string, FunctionSignature[]>();

    const result = annotateChanges([diff], functionMap, ctx);

    expect(result[0].reason).toBe("Important refactor");
    expect(result[0].reason_source).toBe("user-provided");
  });

  it("does not match function outside hunk range", () => {
    const hunk = makeHunk({ new_start: 50, new_count: 5 });
    const diff = makeFileDiff({ hunks: [hunk] });
    const fn = makeFunctionSig({ name: "calculate", start_line: 1, end_line: 10 });
    const functionMap = new Map([["src/utils.ts", [fn]]]);

    const result = annotateChanges([diff], functionMap, makeContext());

    expect(result[0].function_name).toBe("<module-level>");
  });

  it("handles multiple diffs across files", () => {
    const diff1 = makeFileDiff({ file_path: "src/a.ts" });
    const diff2 = makeFileDiff({ file_path: "src/b.ts" });
    const fn1 = makeFunctionSig({ name: "alpha", start_line: 1, end_line: 6 });
    const fn2 = makeFunctionSig({ name: "beta", start_line: 1, end_line: 6 });
    const functionMap = new Map([
      ["src/a.ts", [fn1]],
      ["src/b.ts", [fn2]],
    ]);

    const result = annotateChanges([diff1, diff2], functionMap, makeContext());

    expect(result).toHaveLength(2);
    expect(result[0].file_path).toBe("src/a.ts");
    expect(result[1].file_path).toBe("src/b.ts");
  });
});

describe("toChangeRecords", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T10:00:00.000Z"));
  });

  it("returns empty array for empty annotations", () => {
    const result = toChangeRecords([], "session-123");
    expect(result).toEqual([]);
  });

  it("maps AnnotatedChange to ChangeRecord correctly", () => {
    const annotation: AnnotatedChange = {
      file_path: "src/math.ts",
      function_name: "add",
      function_hash: "hash_add",
      class_name: null,
      change_type: "modify",
      reason: "optimized",
      reason_source: "context",
      hunks: [
        {
          old_start: 1,
          old_count: 2,
          new_start: 1,
          new_count: 2,
          lines: [
            makeDiffLine("delete", "return x + y"),
            makeDiffLine("add", "return x + y + 0"),
          ],
        },
      ],
      start_line: 1,
      end_line: 5,
    };

    const records = toChangeRecords([annotation], "session-xyz");

    expect(records).toHaveLength(1);
    const r = records[0];
    expect(r.timestamp).toBe("2026-01-15T10:00:00.000Z");
    expect(r.file_path).toBe("src/math.ts");
    expect(r.function_hash).toBe("hash_add");
    expect(r.function_name).toBe("add");
    expect(r.class_name).toBeNull();
    expect(r.change_type).toBe("modify");
    expect(r.reason).toBe("optimized");
    expect(r.reason_source).toBe("context");
    expect(r.old_content).toBe("return x + y");
    expect(r.new_content).toBe("return x + y + 0");
    expect(r.start_line).toBe(1);
    expect(r.end_line).toBe(5);
    expect(r.test_status).toBe("pending");
    expect(r.test_file).toBeNull();
    expect(r.error_id).toBeNull();
    expect(r.session_id).toBe("session-xyz");
  });

  it("extracts old_content from delete lines only", () => {
    const annotation: AnnotatedChange = {
      file_path: "src/app.ts",
      function_name: "run",
      function_hash: "hash_run",
      class_name: null,
      change_type: "modify",
      reason: "cleanup",
      reason_source: "llm-inferred",
      hunks: [
        {
          old_start: 1,
          old_count: 3,
          new_start: 1,
          new_count: 2,
          lines: [
            makeDiffLine("context", "import os"),
            makeDiffLine("delete", "import sys"),
            makeDiffLine("delete", "import time"),
            makeDiffLine("add", "import pathlib"),
          ],
        },
      ],
      start_line: 1,
      end_line: 3,
    };

    const records = toChangeRecords([annotation], "s1");

    expect(records[0].old_content).toBe("import sys\nimport time");
    expect(records[0].new_content).toBe("import pathlib");
  });

  it("handles multiple annotations", () => {
    const annotations: AnnotatedChange[] = [
      {
        file_path: "a.ts",
        function_name: "f1",
        function_hash: "h1",
        class_name: null,
        change_type: "add",
        reason: "new",
        reason_source: "user-provided",
        hunks: [makeHunk()],
        start_line: 1,
        end_line: 5,
      },
      {
        file_path: "b.ts",
        function_name: "f2",
        function_hash: "h2",
        class_name: "MyClass",
        change_type: "modify",
        reason: "fix",
        reason_source: "context",
        hunks: [makeHunk()],
        start_line: 10,
        end_line: 20,
      },
    ];

    const records = toChangeRecords(annotations, "session");

    expect(records).toHaveLength(2);
    expect(records[0].function_name).toBe("f1");
    expect(records[1].function_name).toBe("f2");
    expect(records[1].class_name).toBe("MyClass");
  });

  it("returns empty content for context-only hunks", () => {
    const annotation: AnnotatedChange = {
      file_path: "src/noop.ts",
      function_name: "noop",
      function_hash: "hash_noop",
      class_name: null,
      change_type: "modify",
      reason: "ws",
      reason_source: "context",
      hunks: [
        {
          old_start: 1,
          old_count: 2,
          new_start: 1,
          new_count: 2,
          lines: [makeDiffLine("context", "pass"), makeDiffLine("context", "return")],
        },
      ],
      start_line: 1,
      end_line: 2,
    };

    const records = toChangeRecords([annotation], "s");

    expect(records[0].old_content).toBe("");
    expect(records[0].new_content).toBe("");
  });

  it("concatenates lines from multiple hunks", () => {
    const annotation: AnnotatedChange = {
      file_path: "src/multi.ts",
      function_name: "multi",
      function_hash: "hash_multi",
      class_name: null,
      change_type: "modify",
      reason: "split",
      reason_source: "context",
      hunks: [
        {
          old_start: 1,
          old_count: 1,
          new_start: 1,
          new_count: 1,
          lines: [makeDiffLine("delete", "old_a"), makeDiffLine("add", "new_a")],
        },
        {
          old_start: 10,
          old_count: 1,
          new_start: 10,
          new_count: 1,
          lines: [makeDiffLine("delete", "old_b"), makeDiffLine("add", "new_b")],
        },
      ],
      start_line: 1,
      end_line: 15,
    };

    const records = toChangeRecords([annotation], "s");

    expect(records[0].old_content).toBe("old_a\nold_b");
    expect(records[0].new_content).toBe("new_a\nnew_b");
  });
});

describe("deduplicateByFunction", () => {
  it("should execute without throwing", () => {
    const result = deduplicateByFunction([]);
    expect(result).toBeDefined();
  });

  it("should return correct type (AnnotatedChange[])", () => {
    const result = deduplicateByFunction([]);
    expect(Array.isArray(result)).toBe(true);
  });

  it("should return empty array for empty input", () => {
    const result = deduplicateByFunction([]);
    expect(result).toEqual([]);
  });

  it("should return single annotation unchanged when no duplicates", () => {
    const annotation = makeAnnotation();
    const result = deduplicateByFunction([annotation]);
    expect(result).toHaveLength(1);
    expect(result[0].file_path).toBe("src/utils.ts");
    expect(result[0].function_name).toBe("doSomething");
    expect(result[0].function_hash).toBe("abc123");
  });

  it("should merge hunks for duplicate file_path + function_hash", () => {
    const hunk1 = makeHunk({ new_start: 10, new_count: 5 });
    const hunk2 = makeHunk({ new_start: 30, new_count: 3 });

    const a1 = makeAnnotation({ hunks: [hunk1], start_line: 10, end_line: 15 });
    const a2 = makeAnnotation({ hunks: [hunk2], start_line: 30, end_line: 33 });

    const result = deduplicateByFunction([a1, a2]);
    expect(result).toHaveLength(1);
    expect(result[0].hunks).toHaveLength(2);
    expect(result[0].hunks[0]).toEqual(hunk1);
    expect(result[0].hunks[1]).toEqual(hunk2);
  });

  it("should update start_line to minimum of all duplicates", () => {
    const a1 = makeAnnotation({ start_line: 20, end_line: 30 });
    const a2 = makeAnnotation({ start_line: 5, end_line: 25 });

    const result = deduplicateByFunction([a1, a2]);
    expect(result).toHaveLength(1);
    expect(result[0].start_line).toBe(5);
  });

  it("should update end_line to maximum of all duplicates", () => {
    const a1 = makeAnnotation({ start_line: 10, end_line: 20 });
    const a2 = makeAnnotation({ start_line: 15, end_line: 50 });

    const result = deduplicateByFunction([a1, a2]);
    expect(result).toHaveLength(1);
    expect(result[0].end_line).toBe(50);
  });

  it("should not merge annotations with different function_hash", () => {
    const a1 = makeAnnotation({ function_hash: "hash1", function_name: "fn1" });
    const a2 = makeAnnotation({ function_hash: "hash2", function_name: "fn2" });

    const result = deduplicateByFunction([a1, a2]);
    expect(result).toHaveLength(2);
  });

  it("should not merge annotations with different file_path", () => {
    const a1 = makeAnnotation({ file_path: "src/a.ts" });
    const a2 = makeAnnotation({ file_path: "src/b.ts" });

    const result = deduplicateByFunction([a1, a2]);
    expect(result).toHaveLength(2);
  });

  it("should deduplicate key based on file_path::function_hash", () => {
    const a1 = makeAnnotation({ file_path: "src/a.ts", function_hash: "x" });
    const a2 = makeAnnotation({ file_path: "src/a.ts", function_hash: "x" });
    const a3 = makeAnnotation({ file_path: "src/a.ts", function_hash: "y" });

    const result = deduplicateByFunction([a1, a2, a3]);
    expect(result).toHaveLength(2);
  });

  it("should preserve other fields from the first occurrence", () => {
    const a1 = makeAnnotation({
      reason: "first reason",
      change_type: "add",
      class_name: "MyClass",
    });
    const a2 = makeAnnotation({
      reason: "second reason",
      change_type: "modify",
      class_name: "OtherClass",
    });

    const result = deduplicateByFunction([a1, a2]);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe("first reason");
    expect(result[0].change_type).toBe("add");
    expect(result[0].class_name).toBe("MyClass");
  });

  it("should handle many duplicates merging correctly", () => {
    const annotations = Array.from({ length: 5 }, (_, i) =>
      makeAnnotation({
        hunks: [makeHunk({ new_start: i * 10, new_count: 5 })],
        start_line: i * 10,
        end_line: i * 10 + 5,
      })
    );

    const result = deduplicateByFunction(annotations);
    expect(result).toHaveLength(1);
    expect(result[0].hunks).toHaveLength(5);
    expect(result[0].start_line).toBe(0);
    expect(result[0].end_line).toBe(45);
  });

  it("should not mutate the original input array", () => {
    const a1 = makeAnnotation({ start_line: 10, end_line: 20 });
    const a2 = makeAnnotation({ start_line: 5, end_line: 50 });
    const original1StartLine = a1.start_line;
    const original1EndLine = a1.end_line;

    deduplicateByFunction([a1, a2]);

    expect(a1.start_line).toBe(original1StartLine);
    expect(a1.end_line).toBe(original1EndLine);
  });
});
