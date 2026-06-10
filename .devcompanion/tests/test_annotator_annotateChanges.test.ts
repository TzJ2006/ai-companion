import { describe, it, expect, vi, beforeEach } from "vitest";
import { annotateChanges, toChangeRecords } from "../../packages/core/src/diff/annotator.js";
import type { AnnotatedChange, AnnotationContext } from "../../packages/core/src/diff/annotator.js";
import type { FileDiff, DiffHunk } from "../../packages/core/src/diff/parser.js";
import type { FunctionSignature } from "@aidev/ast";

vi.mock("@aidev/ast", () => ({
  computeFunctionIdentity: vi.fn((filePath: string, fn: FunctionSignature) => ({
    hash: `hash::${filePath}::${fn.name}`,
  })),
}));

vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "test-uuid-1234"),
}));

function makeHunk(overrides: Partial<DiffHunk> = {}): DiffHunk {
  return {
    old_start: 1,
    old_count: 5,
    new_start: 1,
    new_count: 7,
    lines: [
      { type: "delete", content: "old line" },
      { type: "add", content: "new line" },
      { type: "context", content: "unchanged" },
    ],
    ...overrides,
  };
}

function makeDiff(overrides: Partial<FileDiff> = {}): FileDiff {
  return {
    file_path: "src/utils.ts",
    status: "modified",
    hunks: [makeHunk()],
    ...overrides,
  } as FileDiff;
}

function makeFunction(overrides: Partial<FunctionSignature> = {}): FunctionSignature {
  return {
    name: "doSomething",
    start_line: 1,
    end_line: 10,
    class_name: null,
    ...overrides,
  } as FunctionSignature;
}

function makeContext(overrides: Partial<AnnotationContext> = {}): AnnotationContext {
  return {
    reason: "refactor for clarity",
    reason_source: "user-provided",
    session_id: "session-abc",
    ...overrides,
  };
}

describe("annotateChanges", () => {
  it("should return empty array for empty diffs", () => {
    const result = annotateChanges([], new Map(), makeContext());
    expect(result).toEqual([]);
  });

  it("should return empty array for diffs with no hunks", () => {
    const diff = makeDiff({ hunks: [] });
    const result = annotateChanges([diff], new Map(), makeContext());
    expect(result).toEqual([]);
  });

  it("should create module-level annotation when no functions overlap the hunk", () => {
    const diff = makeDiff();
    const functionMap = new Map<string, FunctionSignature[]>();

    const result = annotateChanges([diff], functionMap, makeContext());

    expect(result).toHaveLength(1);
    expect(result[0].function_name).toBe("<module-level>");
    expect(result[0].function_hash).toBe("module::src/utils.ts");
    expect(result[0].class_name).toBeNull();
    expect(result[0].file_path).toBe("src/utils.ts");
    expect(result[0].reason).toBe("refactor for clarity");
    expect(result[0].reason_source).toBe("user-provided");
  });

  it("should annotate affected functions when hunk overlaps function range", () => {
    const hunk = makeHunk({ new_start: 3, new_count: 4 });
    const diff = makeDiff({ hunks: [hunk] });
    const fn = makeFunction({ name: "calculate", start_line: 2, end_line: 8 });
    const functionMap = new Map([["src/utils.ts", [fn]]]);

    const result = annotateChanges([diff], functionMap, makeContext());

    expect(result).toHaveLength(1);
    expect(result[0].function_name).toBe("calculate");
    expect(result[0].function_hash).toBe("hash::src/utils.ts::calculate");
    expect(result[0].start_line).toBe(2);
    expect(result[0].end_line).toBe(8);
  });

  it("should annotate multiple functions when hunk spans them", () => {
    const hunk = makeHunk({ new_start: 1, new_count: 30 });
    const diff = makeDiff({ hunks: [hunk] });
    const fn1 = makeFunction({ name: "foo", start_line: 1, end_line: 10 });
    const fn2 = makeFunction({ name: "bar", start_line: 15, end_line: 25 });
    const functionMap = new Map([["src/utils.ts", [fn1, fn2]]]);

    const result = annotateChanges([diff], functionMap, makeContext());

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.function_name)).toEqual(["foo", "bar"]);
  });

  it("should not include functions outside the hunk range", () => {
    const hunk = makeHunk({ new_start: 50, new_count: 5 });
    const diff = makeDiff({ hunks: [hunk] });
    const fn = makeFunction({ name: "farAway", start_line: 1, end_line: 10 });
    const functionMap = new Map([["src/utils.ts", [fn]]]);

    const result = annotateChanges([diff], functionMap, makeContext());

    expect(result).toHaveLength(1);
    expect(result[0].function_name).toBe("<module-level>");
  });

  it("should infer change_type 'add' for added files", () => {
    const diff = makeDiff({ status: "added" });
    const result = annotateChanges([diff], new Map(), makeContext());

    expect(result[0].change_type).toBe("add");
  });

  it("should infer change_type 'delete' for deleted files", () => {
    const diff = makeDiff({ status: "deleted" });
    const result = annotateChanges([diff], new Map(), makeContext());

    expect(result[0].change_type).toBe("delete");
  });

  it("should infer change_type 'rename' for renamed files", () => {
    const diff = makeDiff({ status: "renamed" });
    const result = annotateChanges([diff], new Map(), makeContext());

    expect(result[0].change_type).toBe("rename");
  });

  it("should infer change_type 'modify' for modified files", () => {
    const diff = makeDiff({ status: "modified" });
    const result = annotateChanges([diff], new Map(), makeContext());

    expect(result[0].change_type).toBe("modify");
  });

  it("should deduplicate annotations for the same function across multiple hunks", () => {
    const hunk1 = makeHunk({ new_start: 2, new_count: 3 });
    const hunk2 = makeHunk({ new_start: 7, new_count: 2 });
    const diff = makeDiff({ hunks: [hunk1, hunk2] });
    const fn = makeFunction({ name: "wide", start_line: 1, end_line: 15 });
    const functionMap = new Map([["src/utils.ts", [fn]]]);

    const result = annotateChanges([diff], functionMap, makeContext());

    expect(result).toHaveLength(1);
    expect(result[0].hunks).toHaveLength(2);
    expect(result[0].start_line).toBe(1);
    expect(result[0].end_line).toBe(15);
  });

  it("should preserve class_name from function signature", () => {
    const hunk = makeHunk({ new_start: 5, new_count: 3 });
    const diff = makeDiff({ hunks: [hunk] });
    const fn = makeFunction({ name: "render", start_line: 4, end_line: 10, class_name: "Widget" });
    const functionMap = new Map([["src/utils.ts", [fn]]]);

    const result = annotateChanges([diff], functionMap, makeContext());

    expect(result[0].class_name).toBe("Widget");
  });

  it("should handle multiple diffs across different files", () => {
    const diff1 = makeDiff({ file_path: "src/a.ts", hunks: [makeHunk()] });
    const diff2 = makeDiff({ file_path: "src/b.ts", hunks: [makeHunk()] });
    const functionMap = new Map<string, FunctionSignature[]>();

    const result = annotateChanges([diff1, diff2], functionMap, makeContext());

    expect(result).toHaveLength(2);
    expect(result[0].file_path).toBe("src/a.ts");
    expect(result[1].file_path).toBe("src/b.ts");
  });

  it("should propagate reason_source from context", () => {
    const diff = makeDiff();
    const ctx = makeContext({ reason_source: "llm-inferred" });

    const result = annotateChanges([diff], new Map(), ctx);

    expect(result[0].reason_source).toBe("llm-inferred");
  });
});

describe("toChangeRecords", () => {
  it("should convert annotations to change records with required fields", () => {
    const annotations: AnnotatedChange[] = [
      {
        file_path: "src/index.ts",
        function_name: "main",
        function_hash: "hash::main",
        class_name: null,
        change_type: "modify",
        reason: "bug fix",
        reason_source: "user-provided",
        hunks: [makeHunk()],
        start_line: 1,
        end_line: 10,
      },
    ];

    const records = toChangeRecords(annotations, "session-xyz");

    expect(records).toHaveLength(1);
    const r = records[0];
    expect(r.id).toBe("test-uuid-1234");
    expect(r.file_path).toBe("src/index.ts");
    expect(r.function_hash).toBe("hash::main");
    expect(r.function_name).toBe("main");
    expect(r.class_name).toBeNull();
    expect(r.change_type).toBe("modify");
    expect(r.reason).toBe("bug fix");
    expect(r.reason_source).toBe("user-provided");
    expect(r.session_id).toBe("session-xyz");
    expect(r.test_status).toBe("pending");
    expect(r.test_file).toBeNull();
    expect(r.error_id).toBeNull();
    expect(r.start_line).toBe(1);
    expect(r.end_line).toBe(10);
  });

  it("should extract old_content from delete lines in hunks", () => {
    const hunk = makeHunk({
      lines: [
        { type: "delete", content: "removed line 1" },
        { type: "delete", content: "removed line 2" },
        { type: "add", content: "added line" },
      ],
    });
    const annotations: AnnotatedChange[] = [
      {
        file_path: "src/x.ts",
        function_name: "fn",
        function_hash: "h",
        class_name: null,
        change_type: "modify",
        reason: "r",
        reason_source: "context",
        hunks: [hunk],
        start_line: 1,
        end_line: 5,
      },
    ];

    const records = toChangeRecords(annotations, "s1");

    expect(records[0].old_content).toBe("removed line 1\nremoved line 2");
  });

  it("should extract new_content from add lines in hunks", () => {
    const hunk = makeHunk({
      lines: [
        { type: "delete", content: "old" },
        { type: "add", content: "new line 1" },
        { type: "add", content: "new line 2" },
      ],
    });
    const annotations: AnnotatedChange[] = [
      {
        file_path: "src/x.ts",
        function_name: "fn",
        function_hash: "h",
        class_name: null,
        change_type: "modify",
        reason: "r",
        reason_source: "context",
        hunks: [hunk],
        start_line: 1,
        end_line: 5,
      },
    ];

    const records = toChangeRecords(annotations, "s1");

    expect(records[0].new_content).toBe("new line 1\nnew line 2");
  });

  it("should produce valid ISO timestamp", () => {
    const annotations: AnnotatedChange[] = [
      {
        file_path: "f.ts",
        function_name: "x",
        function_hash: "h",
        class_name: null,
        change_type: "add",
        reason: "r",
        reason_source: "context",
        hunks: [],
        start_line: 1,
        end_line: 1,
      },
    ];

    const records = toChangeRecords(annotations, "s");

    expect(new Date(records[0].timestamp).toISOString()).toBe(records[0].timestamp);
  });

  it("should return empty array for empty annotations", () => {
    const records = toChangeRecords([], "session");
    expect(records).toEqual([]);
  });
});
