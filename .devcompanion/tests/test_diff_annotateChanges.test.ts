import { describe, it, expect, vi, beforeEach } from "vitest";
import { annotateChanges, toChangeRecords } from "../../packages/core/src/diff/annotator.js";
import type { AnnotationContext, AnnotatedChange } from "../../packages/core/src/diff/annotator.js";
import type { FileDiff, DiffHunk } from "../../packages/core/src/diff/parser.js";
import type { FunctionSignature } from "@aidev/ast";

vi.mock("@aidev/ast", () => ({
  computeFunctionIdentity: (filePath: string, fn: FunctionSignature) => ({
    hash: `hash::${filePath}::${fn.class_name ?? ""}::${fn.name}`,
  }),
}));

vi.mock("node:crypto", () => ({
  randomUUID: () => "00000000-0000-0000-0000-000000000001",
}));

function makeHunk(overrides: Partial<DiffHunk> = {}): DiffHunk {
  return {
    old_start: 1,
    old_count: 3,
    new_start: 1,
    new_count: 5,
    header: "@@ -1,3 +1,5 @@",
    lines: [
      { type: "context", content: "  existing line" },
      { type: "delete", content: "  old code" },
      { type: "add", content: "  new code" },
      { type: "add", content: "  more new code" },
    ],
    ...overrides,
  };
}

function makeDiff(overrides: Partial<FileDiff> = {}): FileDiff {
  return {
    file_path: "src/utils.py",
    old_path: "src/utils.py",
    status: "modified",
    hunks: [makeHunk()],
    ...overrides,
  } as FileDiff;
}

function makeFunction(overrides: Partial<FunctionSignature> = {}): FunctionSignature {
  return {
    name: "calculate",
    class_name: null,
    params: [{ name: "x", type: "int" }],
    return_type: "int",
    start_line: 1,
    end_line: 10,
    ...overrides,
  } as FunctionSignature;
}

function makeContext(overrides: Partial<AnnotationContext> = {}): AnnotationContext {
  return {
    reason: "Refactored calculation logic",
    reason_source: "context",
    session_id: "session-123",
    ...overrides,
  };
}

describe("annotateChanges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array for empty inputs", () => {
    const result = annotateChanges([], new Map(), makeContext());
    expect(result).toEqual([]);
  });

  it("returns module-level annotation when no functions match the hunk", () => {
    const diffs = [makeDiff()];
    const functionMap = new Map<string, FunctionSignature[]>();

    const result = annotateChanges(diffs, functionMap, makeContext());

    expect(result).toHaveLength(1);
    expect(result[0].function_name).toBe("<module-level>");
    expect(result[0].function_hash).toBe("module::src/utils.py");
    expect(result[0].class_name).toBeNull();
    expect(result[0].file_path).toBe("src/utils.py");
    expect(result[0].reason).toBe("Refactored calculation logic");
    expect(result[0].reason_source).toBe("context");
  });

  it("annotates a function when hunk overlaps its line range", () => {
    const hunk = makeHunk({ new_start: 3, new_count: 4 });
    const diffs = [makeDiff({ hunks: [hunk] })];
    const fn = makeFunction({ name: "calculate", start_line: 2, end_line: 8 });
    const functionMap = new Map([["src/utils.py", [fn]]]);

    const result = annotateChanges(diffs, functionMap, makeContext());

    expect(result).toHaveLength(1);
    expect(result[0].function_name).toBe("calculate");
    expect(result[0].function_hash).toBe("hash::src/utils.py::::calculate");
    expect(result[0].start_line).toBe(2);
    expect(result[0].end_line).toBe(8);
  });

  it("annotates multiple functions when hunk spans both", () => {
    const hunk = makeHunk({ new_start: 5, new_count: 20 });
    const diffs = [makeDiff({ hunks: [hunk] })];
    const fn1 = makeFunction({ name: "foo", start_line: 1, end_line: 10 });
    const fn2 = makeFunction({ name: "bar", start_line: 15, end_line: 30 });
    const functionMap = new Map([["src/utils.py", [fn1, fn2]]]);

    const result = annotateChanges(diffs, functionMap, makeContext());

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.function_name)).toContain("foo");
    expect(result.map((r) => r.function_name)).toContain("bar");
  });

  it("does not match function outside hunk range", () => {
    const hunk = makeHunk({ new_start: 50, new_count: 5 });
    const diffs = [makeDiff({ hunks: [hunk] })];
    const fn = makeFunction({ name: "unrelated", start_line: 1, end_line: 10 });
    const functionMap = new Map([["src/utils.py", [fn]]]);

    const result = annotateChanges(diffs, functionMap, makeContext());

    expect(result).toHaveLength(1);
    expect(result[0].function_name).toBe("<module-level>");
  });

  it("deduplicates annotations for the same function across multiple hunks", () => {
    const hunk1 = makeHunk({ new_start: 2, new_count: 3 });
    const hunk2 = makeHunk({ new_start: 7, new_count: 2 });
    const diffs = [makeDiff({ hunks: [hunk1, hunk2] })];
    const fn = makeFunction({ name: "calculate", start_line: 1, end_line: 10 });
    const functionMap = new Map([["src/utils.py", [fn]]]);

    const result = annotateChanges(diffs, functionMap, makeContext());

    expect(result).toHaveLength(1);
    expect(result[0].function_name).toBe("calculate");
    expect(result[0].hunks).toHaveLength(2);
    expect(result[0].start_line).toBe(1);
    expect(result[0].end_line).toBe(10);
  });

  it("infers change_type 'add' for added files", () => {
    const diffs = [makeDiff({ status: "added" })];
    const functionMap = new Map<string, FunctionSignature[]>();

    const result = annotateChanges(diffs, functionMap, makeContext());

    expect(result[0].change_type).toBe("add");
  });

  it("infers change_type 'delete' for deleted files", () => {
    const diffs = [makeDiff({ status: "deleted" })];
    const functionMap = new Map<string, FunctionSignature[]>();

    const result = annotateChanges(diffs, functionMap, makeContext());

    expect(result[0].change_type).toBe("delete");
  });

  it("infers change_type 'rename' for renamed files", () => {
    const diffs = [makeDiff({ status: "renamed" })];
    const functionMap = new Map<string, FunctionSignature[]>();

    const result = annotateChanges(diffs, functionMap, makeContext());

    expect(result[0].change_type).toBe("rename");
  });

  it("infers change_type 'modify' for modified files", () => {
    const diffs = [makeDiff({ status: "modified" })];
    const functionMap = new Map<string, FunctionSignature[]>();

    const result = annotateChanges(diffs, functionMap, makeContext());

    expect(result[0].change_type).toBe("modify");
  });

  it("includes class_name from function signature", () => {
    const hunk = makeHunk({ new_start: 5, new_count: 3 });
    const diffs = [makeDiff({ hunks: [hunk] })];
    const fn = makeFunction({ name: "method", class_name: "MyClass", start_line: 3, end_line: 12 });
    const functionMap = new Map([["src/utils.py", [fn]]]);

    const result = annotateChanges(diffs, functionMap, makeContext());

    expect(result[0].class_name).toBe("MyClass");
    expect(result[0].function_hash).toBe("hash::src/utils.py::MyClass::method");
  });

  it("preserves reason_source from context", () => {
    const diffs = [makeDiff()];
    const ctx = makeContext({ reason_source: "llm-inferred" });
    const functionMap = new Map<string, FunctionSignature[]>();

    const result = annotateChanges(diffs, functionMap, ctx);

    expect(result[0].reason_source).toBe("llm-inferred");
  });

  it("handles multiple diffs across different files", () => {
    const diff1 = makeDiff({ file_path: "src/a.py", hunks: [makeHunk({ new_start: 1, new_count: 5 })] });
    const diff2 = makeDiff({ file_path: "src/b.py", hunks: [makeHunk({ new_start: 1, new_count: 5 })] });
    const fn1 = makeFunction({ name: "alpha", start_line: 1, end_line: 6 });
    const fn2 = makeFunction({ name: "beta", start_line: 2, end_line: 7 });
    const functionMap = new Map([
      ["src/a.py", [fn1]],
      ["src/b.py", [fn2]],
    ]);

    const result = annotateChanges([diff1, diff2], functionMap, makeContext());

    expect(result).toHaveLength(2);
    expect(result[0].file_path).toBe("src/a.py");
    expect(result[1].file_path).toBe("src/b.py");
  });
});

describe("toChangeRecords", () => {
  it("converts annotations to change records with correct fields", () => {
    const annotations: AnnotatedChange[] = [
      {
        file_path: "src/utils.py",
        function_name: "calculate",
        function_hash: "hash123",
        class_name: null,
        change_type: "modify",
        reason: "Bug fix",
        reason_source: "user-provided",
        hunks: [makeHunk()],
        start_line: 1,
        end_line: 10,
      },
    ];

    const records = toChangeRecords(annotations, "session-abc");

    expect(records).toHaveLength(1);
    const r = records[0];
    expect(r.id).toBe("00000000-0000-0000-0000-000000000001");
    expect(r.file_path).toBe("src/utils.py");
    expect(r.function_name).toBe("calculate");
    expect(r.function_hash).toBe("hash123");
    expect(r.class_name).toBeNull();
    expect(r.change_type).toBe("modify");
    expect(r.reason).toBe("Bug fix");
    expect(r.reason_source).toBe("user-provided");
    expect(r.session_id).toBe("session-abc");
    expect(r.test_status).toBe("pending");
    expect(r.test_file).toBeNull();
    expect(r.error_id).toBeNull();
    expect(r.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("extracts old_content from delete lines in hunks", () => {
    const hunk = makeHunk({
      lines: [
        { type: "delete", content: "  removed line 1" },
        { type: "delete", content: "  removed line 2" },
        { type: "add", content: "  added line" },
      ],
    });
    const annotations: AnnotatedChange[] = [
      {
        file_path: "src/x.py",
        function_name: "fn",
        function_hash: "h1",
        class_name: null,
        change_type: "modify",
        reason: "refactor",
        reason_source: "context",
        hunks: [hunk],
        start_line: 1,
        end_line: 5,
      },
    ];

    const records = toChangeRecords(annotations, "s1");

    expect(records[0].old_content).toBe("  removed line 1\n  removed line 2");
    expect(records[0].new_content).toBe("  added line");
  });

  it("returns empty strings for old/new content when no relevant lines", () => {
    const hunk = makeHunk({
      lines: [{ type: "context", content: "  unchanged" }],
    });
    const annotations: AnnotatedChange[] = [
      {
        file_path: "src/x.py",
        function_name: "fn",
        function_hash: "h1",
        class_name: null,
        change_type: "modify",
        reason: "no-op",
        reason_source: "context",
        hunks: [hunk],
        start_line: 1,
        end_line: 5,
      },
    ];

    const records = toChangeRecords(annotations, "s1");

    expect(records[0].old_content).toBe("");
    expect(records[0].new_content).toBe("");
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
        reason_source: "context",
        hunks: [makeHunk()],
        start_line: 1,
        end_line: 5,
      },
      {
        file_path: "b.py",
        function_name: "f2",
        function_hash: "h2",
        class_name: "Cls",
        change_type: "modify",
        reason: "fix",
        reason_source: "llm-inferred",
        hunks: [makeHunk()],
        start_line: 10,
        end_line: 20,
      },
    ];

    const records = toChangeRecords(annotations, "s2");

    expect(records).toHaveLength(2);
    expect(records[0].function_name).toBe("f1");
    expect(records[1].function_name).toBe("f2");
    expect(records[1].class_name).toBe("Cls");
  });
});
