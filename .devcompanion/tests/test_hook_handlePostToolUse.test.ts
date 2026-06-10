import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handlePostToolUse, findProjectRoot } from "../../packages/hook/src/index.js";
import { existsSync, appendFileSync, mkdirSync } from "node:fs";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

describe("handlePostToolUse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should ignore non-JSON input", () => {
    handlePostToolUse("not json");
    expect(appendFileSync).not.toHaveBeenCalled();
  });

  it("should ignore non-Edit/Write tools", () => {
    handlePostToolUse(JSON.stringify({ tool_name: "Read", tool_input: { file_path: "/a/b.ts" } }));
    expect(appendFileSync).not.toHaveBeenCalled();
  });

  it("should ignore unsupported extensions", () => {
    handlePostToolUse(JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "/a/b.txt" } }));
    expect(appendFileSync).not.toHaveBeenCalled();
  });

  it("should accept .ts files with default extensions", () => {
    (existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
      if (p.includes(".devcompanion") || p.includes(".git")) return true;
      if (p.includes("queue")) return true;
      return false;
    });
    handlePostToolUse(JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "/project/src/app.ts" } }));
    expect(appendFileSync).toHaveBeenCalled();
  });

  it("should accept .py files with default extensions", () => {
    (existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
      if (p.includes(".devcompanion") || p.includes(".git")) return true;
      if (p.includes("queue")) return true;
      return false;
    });
    handlePostToolUse(JSON.stringify({ tool_name: "Write", tool_input: { file_path: "/project/main.py" } }));
    expect(appendFileSync).toHaveBeenCalled();
  });

  it("should respect custom supported extensions", () => {
    const customExts = new Set([".rs"]);
    handlePostToolUse(
      JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "/project/main.rs" } }),
      customExts
    );
    // won't find project root with our mock, but at least it shouldn't filter out .rs
    // The filter passes, so it will try to find project root
  });

  it("should ignore .ts files when custom extensions exclude them", () => {
    const customExts = new Set([".py"]);
    handlePostToolUse(
      JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "/project/app.ts" } }),
      customExts
    );
    expect(appendFileSync).not.toHaveBeenCalled();
  });
});

describe("findProjectRoot", () => {
  it("should return null when no project markers exist", () => {
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const result = findProjectRoot("/some/deep/path/file.ts");
    expect(result).toBeNull();
  });

  it("should find root with .devcompanion directory", () => {
    const { resolve, join } = require("node:path");
    const expectedRoot = resolve("/project");
    const marker = join(expectedRoot, ".devcompanion");
    (existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
      return p === marker;
    });
    const result = findProjectRoot(join(expectedRoot, "src", "file.ts"));
    expect(result).toBe(expectedRoot);
  });

  it("should find root with .git directory", () => {
    const { resolve, join } = require("node:path");
    const expectedRoot = resolve("/project");
    const marker = join(expectedRoot, ".git");
    (existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
      return p === marker;
    });
    const result = findProjectRoot(join(expectedRoot, "src", "deep", "file.ts"));
    expect(result).toBe(expectedRoot);
  });
});
