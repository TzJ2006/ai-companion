import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  annotateChanges,
  toChangeRecords,
  type AnnotationContext,
  type AnnotatedChange,
} from "../../packages/core/src/diff/annotator.js";
import type { FileDiff, DiffHunk, DiffLine } from "../../packages/core/src/diff/parser.js";
import type { FunctionSignature } from "@aidev/ast";

vi.mock("@aidev/ast", () => ({
  computeFunctionIdentity: (filePath: string, fn: FunctionSignature) => ({
    hash: `hash_${fn.name}_${filePath}`,
    file_path: filePath,
    function_name: fn.name,
    class_name: fn.class_name,
    param_signature: fn.params.map((p) => p.type).join(","),
  }),
}));

vi.mock("node:crypto", () => ({
  randomUUID: () => "00000000-0000-0000-0000-000000000001",
}));

function makeDiffLine(type: DiffLine["type"], content: string): DiffLine {
  return { type, content, old_line: type === "delete" ? 1 : null, new_line: type === "add" ? 1 : null };
}

function makeHunk(overrides: Partial<DiffHunk> = {}): DiffHunk {
  return {
    old_start: 1,
    old_count: 3,
    new_start: 1,
    new_count: 5,
    lines: [
      makeDiffLine("delete", "old line"),
      makeDiffLine("add", "new line"),
      makeDiffLine("context", "unchanged"),
    ],
    ...overrides,
  };
}

function makeFileDiff(overrides: Partial<FileDiff> = {}): FileDiff {
  return {
    file_path: "src/utils.py",
    old_path: null,
    status: "modified",
    hunks: [makeHunk()],
    raw_diff: "diff --git a/src/utils.py b/src/utils.py",
    ...overrides,
  };
}

function makeFunctionSig(overrides: Partial<FunctionSignature> = {}): FunctionSignature {
  return {
    name: "calculate",
    params: [{ name: "x", type: "int", default_value: null }],
    return_type: "int",
    decorators: [],
    is_method: false,
    is_async: false,
    class_name: null,
    start_line: 1,
    end_line: 10,
    docstring: null,
    ...overrides,
  };
}

function makeContext(overrides: Partial<AnnotationContext> = {}): AnnotationContext {
  return {
    reason: "Refactored calculation logic",
    reason_source: "context",
    session_id: "session-abc",
    ...overrides,
  };
}

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
    expect(result[0].function_hash).toBe("module::src/utils.py");
    expect(result[0].class_name).toBeNull();
    expect(result[0].change_type).toBe("modify");
    expect(result[0].reason).toBe("Refactored calculation logic");
    expect(result[0].reason_source).toBe("context");
  });

  it("annotates function when hunk overlaps function range", () => {
    const diff = makeFileDiff();
    const fn = makeFunctionSig({ name: "calculate", start_line: 1, end_line: 10 });
    const functionMap = new Map([["src/utils.py", [fn]]]);

    const result = annotateChanges([diff], functionMap, makeContext());

    expect(result).toHaveLength(1);
    expect(result[0].function_name).toBe("calculate");
    expect(result[0].function_hash).toBe("hash_calculate_src/utils.py");
    expect(result[0].start_line).toBe(1);
    expect(result[0].end_line).toBe(10);
  });

  it("annotates multiple functions when hunk spans them", () => {
    const hunk = makeHunk({ new_start: 1, new_count: 30 });
    const diff = makeFileDiff({ hunks: [hunk] });
    const fn1 = makeFunctionSig({ name: "foo", start_line: 1, end_line: 10 });
    const fn2 = makeFunctionSig({ name: "bar", start_line: 15, end_line: 25 });
    const functionMap = new Map([["src/utils.py", [fn1, fn2]]]);

    const result = annotateChanges([diff], functionMap, makeContext());

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.function_name)).toContain("foo");
    expect(result.map((r) => r.function_name)).toContain("bar");
  });

  it("deduplicates annotations for the same function across hunks", () => {
    const hunk1 = makeHunk({ new_start: 2, new_count: 3 });
    const hunk2 = makeHunk({ new_start: 7, new_count: 2 });
    const diff = makeFileDiff({ hunks: [hunk1, hunk2] });
    const fn = makeFunctionSig({ name: "calculate", start_line: 1, end_line: 10 });
    const functionMap = new Map([["src/utils.py", [fn]]]);

    const result = annotateChanges([diff], functionMap, makeContext());

    expect(result).toHaveLength(1);
    expect(result[0].hunks).toHaveLength(2);
    expect(result[0].start_line).toBe(1);
    expect(result[0].end_line).toBe(10);
  });

  it("infers 'add' change_type for added files", () => {
    const diff = makeFileDiff({ status: "added" });
    const functionMap = new Map<string, FunctionSignature[]>();

    const result = annotateChanges([diff], functionMap, makeContext());

    expect(result[0].change_type).toBe("add");
  });

  it("infers 'delete' change_type for deleted files", () => {
    const diff = makeFileDiff({ status: "deleted" });
    const functionMap = new Map<string, FunctionSignature[]>();

    const result = annotateChanges([diff], functionMap, makeContext());

    expect(result[0].change_type).toBe("delete");
  });

  it("infers 'rename' change_type for renamed files", () => {
    const diff = makeFileDiff({ status: "renamed", old_path: "src/old_utils.py" });
    const functionMap = new Map<string, FunctionSignature[]>();

    const result = annotateChanges([diff], functionMap, makeContext());

    expect(result[0].change_type).toBe("rename");
  });

  it("handles class methods with class_name set", () => {
    const diff = makeFileDiff();
    const fn = makeFunctionSig({ name: "do_work", class_name: "Worker", is_method: true, start_line: 1, end_line: 8 });
    const functionMap = new Map([["src/utils.py", [fn]]]);

    const result = annotateChanges([diff], functionMap, makeContext());

    expect(result[0].class_name).toBe("Worker");
    expect(result[0].function_name).toBe("do_work");
  });

  it("handles multiple diffs across different files", () => {
    const diff1 = makeFileDiff({ file_path: "src/a.py" });
    const diff2 = makeFileDiff({ file_path: "src/b.py" });
    const fn1 = makeFunctionSig({ name: "alpha", start_line: 1, end_line: 6 });
    const fn2 = makeFunctionSig({ name: "beta", start_line: 1, end_line: 6 });
    const functionMap = new Map([
      ["src/a.py", [fn1]],
      ["src/b.py", [fn2]],
    ]);

    const result = annotateChanges([diff1, diff2], functionMap, makeContext());

    expect(result).toHaveLength(2);
    expect(result[0].file_path).toBe("src/a.py");
    expect(result[1].file_path).toBe("src/b.py");
  });

  it("does not match function when hunk is entirely outside function range", () => {
    const hunk = makeHunk({ new_start: 50, new_count: 5 });
    const diff = makeFileDiff({ hunks: [hunk] });
    const fn = makeFunctionSig({ name: "calculate", start_line: 1, end_line: 10 });
    const functionMap = new Map([["src/utils.py", [fn]]]);

    const result = annotateChanges([diff], functionMap, makeContext());

    expect(result).toHaveLength(1);
    expect(result[0].function_name).toBe("<module-level>");
  });

  it("preserves reason_source from context", () => {
    const diff = makeFileDiff();
    const ctx = makeContext({ reason_source: "user-provided" });
    const functionMap = new Map<string, FunctionSignature[]>();

    const result = annotateChanges([diff], functionMap, ctx);

    expect(result[0].reason_source).toBe("user-provided");
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

  it("maps AnnotatedChange fields to ChangeRecord correctly", () => {
    const annotation: AnnotatedChange = {
      file_path: "src/math.py",
      function_name: "add",
      function_hash: "hash_add",
      class_name: null,
      change_type: "modify",
      reason: "optimized addition",
      reason_source: "context",
      hunks: [
        {
          old_start: 1,
          old_count: 2,
          new_start: 1,
          new_count: 3,
          lines: [
            makeDiffLine("delete", "return x + y"),
            makeDiffLine("add", "result = x + y"),
            makeDiffLine("add", "return result"),
          ],
        },
      ],
      start_line: 1,
      end_line: 5,
    };

    const records = toChangeRecords([annotation], "session-xyz");

    expect(records).toHaveLength(1);
    const r = records[0];
    expect(r.id).toBe("00000000-0000-0000-0000-000000000001");
    expect(r.timestamp).toBe("2026-01-15T10:00:00.000Z");
    expect(r.file_path).toBe("src/math.py");
    expect(r.function_hash).toBe("hash_add");
    expect(r.function_name).toBe("add");
    expect(r.class_name).toBeNull();
    expect(r.change_type).toBe("modify");
    expect(r.reason).toBe("optimized addition");
    expect(r.reason_source).toBe("context");
    expect(r.old_content).toBe("return x + y");
    expect(r.new_content).toBe("result = x + y\nreturn result");
    expect(r.start_line).toBe(1);
    expect(r.end_line).toBe(5);
    expect(r.test_status).toBe("pending");
    expect(r.test_file).toBeNull();
    expect(r.error_id).toBeNull();
    expect(r.session_id).toBe("session-xyz");
  });

  it("extracts old_content from delete lines only", () => {
    const annotation: AnnotatedChange = {
      file_path: "src/app.py",
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

  it("handles multiple annotations producing multiple records", () => {
    const annotations: AnnotatedChange[] = [
      {
        file_path: "a.py",
        function_name: "f1",
        function_hash: "h1",
        class_name: null,
        change_type: "add",
        reason: "new feature",
        reason_source: "user-provided",
        hunks: [makeHunk()],
        start_line: 1,
        end_line: 5,
      },
      {
        file_path: "b.py",
        function_name: "f2",
        function_hash: "h2",
        class_name: "MyClass",
        change_type: "modify",
        reason: "bugfix",
        reason_source: "context",
        hunks: [makeHunk()],
        start_line: 10,
        end_line: 20,
      },
    ];

    const records = toChangeRecords(annotations, "session-multi");

    expect(records).toHaveLength(2);
    expect(records[0].function_name).toBe("f1");
    expect(records[1].function_name).toBe("f2");
    expect(records[1].class_name).toBe("MyClass");
    expect(records.every((r) => r.session_id === "session-multi")).toBe(true);
  });

  it("returns empty old_content and new_content for context-only hunks", () => {
    const annotation: AnnotatedChange = {
      file_path: "src/noop.py",
      function_name: "noop",
      function_hash: "hash_noop",
      class_name: null,
      change_type: "modify",
      reason: "whitespace",
      reason_source: "context",
      hunks: [
        {
          old_start: 1,
          old_count: 2,
          new_start: 1,
          new_count: 2,
          lines: [
            makeDiffLine("context", "pass"),
            makeDiffLine("context", "return None"),
          ],
        },
      ],
      start_line: 1,
      end_line: 2,
    };

    const records = toChangeRecords([annotation], "s2");

    expect(records[0].old_content).toBe("");
    expect(records[0].new_content).toBe("");
  });

  it("concatenates lines from multiple hunks for content extraction", () => {
    const annotation: AnnotatedChange = {
      file_path: "src/multi.py",
      function_name: "multi",
      function_hash: "hash_multi",
      class_name: null,
      change_type: "modify",
      reason: "split changes",
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

    const records = toChangeRecords([annotation], "s3");

    expect(records[0].old_content).toBe("old_a\nold_b");
    expect(records[0].new_content).toBe("new_a\nnew_b");
  });
});
