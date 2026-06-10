import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const mockParseFileAuto = vi.fn().mockResolvedValue({
  file_path: "",
  functions: [],
  classes: [],
  imports: [],
});
const mockGetSupportedExtensions = vi.fn().mockReturnValue([".ts", ".py"]);
const mockComputeFunctionIdentity = vi.fn((_path: string, fn: { name: string }) => ({
  hash: `hash_${fn.name}`,
  display: fn.name,
}));
const mockGenerateTestSkeleton = vi.fn().mockReturnValue([]);
const mockWriteIndex = vi.fn().mockResolvedValue(undefined);

vi.mock("@aidev/ast", () => ({
  parseFileAuto: (...args: unknown[]) => mockParseFileAuto(...args),
  getSupportedExtensions: () => mockGetSupportedExtensions(),
  computeFunctionIdentity: (...args: unknown[]) => mockComputeFunctionIdentity(...(args as [string, { name: string }])),
}));

vi.mock("@aidev/core", () => ({
  generateTestSkeleton: (...args: unknown[]) => mockGenerateTestSkeleton(...args),
}));

vi.mock("@aidev/history", () => ({
  HistoryStore: class {
    init() { return Promise.resolve(); }
    writeIndex(...args: unknown[]) { return mockWriteIndex(...args); }
  },
}));

import { onboardCommand } from "../../packages/cli/src/commands/onboard.js";

let tmpDir: string;

beforeEach(async () => {
  mockParseFileAuto.mockClear();
  mockParseFileAuto.mockResolvedValue({
    file_path: "",
    functions: [],
    classes: [],
    imports: [],
  });
  mockGetSupportedExtensions.mockClear();
  mockGetSupportedExtensions.mockReturnValue([".ts", ".py"]);
  mockComputeFunctionIdentity.mockClear();
  mockComputeFunctionIdentity.mockImplementation((_path: string, fn: { name: string }) => ({
    hash: `hash_${fn.name}`,
    display: fn.name,
  }));
  mockWriteIndex.mockClear();
  mockWriteIndex.mockResolvedValue(undefined);
  mockGenerateTestSkeleton.mockClear();
  mockGenerateTestSkeleton.mockReturnValue([]);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  tmpDir = await mkdtemp(join(tmpdir(), "onboard-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function createFile(relativePath: string, content = "// code") {
  const fullPath = join(tmpDir, relativePath);
  await mkdir(join(fullPath, ".."), { recursive: true });
  await writeFile(fullPath, content);
}

describe("onboard command - collectFiles logic", () => {
  it("should find .ts files in a flat directory", async () => {
    await createFile("src/index.ts");
    await createFile("src/utils.ts");

    await onboardCommand.parseAsync(["onboard", "-p", tmpDir, "--json", "--no-tests"], { from: "user" });

    expect(mockParseFileAuto).toHaveBeenCalledTimes(2);
  });

  it("should skip node_modules directory", async () => {
    await createFile("src/app.ts");
    await createFile("node_modules/pkg/index.ts");

    await onboardCommand.parseAsync(["onboard", "-p", tmpDir, "--json", "--no-tests"], { from: "user" });

    expect(mockParseFileAuto).toHaveBeenCalledTimes(1);
    expect(mockParseFileAuto).toHaveBeenCalledWith(expect.stringContaining("app.ts"));
  });

  it("should skip hidden files (starting with dot)", async () => {
    await createFile(".hidden.ts");
    await createFile("visible.ts");

    await onboardCommand.parseAsync(["onboard", "-p", tmpDir, "--json", "--no-tests"], { from: "user" });

    expect(mockParseFileAuto).toHaveBeenCalledTimes(1);
    expect(mockParseFileAuto).toHaveBeenCalledWith(expect.stringContaining("visible.ts"));
  });

  it("should only collect files matching supported extensions", async () => {
    await createFile("app.ts");
    await createFile("script.py");
    await createFile("readme.md");
    await createFile("image.png");

    await onboardCommand.parseAsync(["onboard", "-p", tmpDir, "--json", "--no-tests"], { from: "user" });

    expect(mockParseFileAuto).toHaveBeenCalledTimes(2);
    const calls = mockParseFileAuto.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((p) => p.endsWith("app.ts"))).toBe(true);
    expect(calls.some((p) => p.endsWith("script.py"))).toBe(true);
  });

  it("should recurse into nested directories", async () => {
    await createFile("src/deep/nested/file.ts");

    await onboardCommand.parseAsync(["onboard", "-p", tmpDir, "--json", "--no-tests"], { from: "user" });

    expect(mockParseFileAuto).toHaveBeenCalledTimes(1);
    expect(mockParseFileAuto).toHaveBeenCalledWith(expect.stringContaining("file.ts"));
  });

  it("should skip dist, build, and __pycache__ directories", async () => {
    await createFile("src/main.ts");
    await createFile("dist/main.ts");
    await createFile("build/output.ts");
    await createFile("__pycache__/mod.py");

    await onboardCommand.parseAsync(["onboard", "-p", tmpDir, "--json", "--no-tests"], { from: "user" });

    expect(mockParseFileAuto).toHaveBeenCalledTimes(1);
    const call = mockParseFileAuto.mock.calls[0][0] as string;
    expect(call).toContain("main.ts");
    expect(call).toContain("src");
  });

  it("should handle empty directory without error", async () => {
    await expect(
      onboardCommand.parseAsync(["onboard", "-p", tmpDir, "--json", "--no-tests"], { from: "user" })
    ).resolves.not.toThrow();

    expect(mockParseFileAuto).toHaveBeenCalledTimes(0);
  });

  it("should continue scanning when a file fails to parse", async () => {
    await createFile("good.ts");
    await createFile("bad.ts");

    mockParseFileAuto
      .mockResolvedValueOnce({ file_path: "", functions: [], classes: [], imports: [] })
      .mockRejectedValueOnce(new Error("Parse error"));

    const warnSpy = console.warn as ReturnType<typeof vi.fn>;
    await onboardCommand.parseAsync(["onboard", "-p", tmpDir, "--json", "--no-tests"], { from: "user" });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Warning"));
  });

  it("should call writeIndex with correct structure", async () => {
    await createFile("app.ts");

    await onboardCommand.parseAsync(["onboard", "-p", tmpDir, "--json", "--no-tests"], { from: "user" });

    expect(mockWriteIndex).toHaveBeenCalledTimes(1);
    const indexArg = mockWriteIndex.mock.calls[0][0] as Record<string, unknown>;
    expect(indexArg.project_root).toBe(tmpDir);
    expect(indexArg.last_updated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(indexArg.total_sessions).toBe(0);
    expect(indexArg.total_changes).toBe(0);
    expect(indexArg.function_index).toBeDefined();
    expect(typeof indexArg.function_index).toBe("object");
  });

  it("should output JSON with expected fields when --json flag is passed", async () => {
    await createFile("file.py");

    const consoleSpy = console.log as ReturnType<typeof vi.fn>;
    await onboardCommand.parseAsync(["onboard", "-p", tmpDir, "--json", "--no-tests"], { from: "user" });

    const jsonCall = consoleSpy.mock.calls.find((c: string[]) => {
      try {
        const parsed = JSON.parse(c[0]);
        return "files_scanned" in parsed;
      } catch {
        return false;
      }
    });

    expect(jsonCall).toBeDefined();
    const result = JSON.parse(jsonCall![0]);
    expect(result).toHaveProperty("files_scanned", 1);
    expect(result).toHaveProperty("functions_found", 0);
    expect(result).toHaveProperty("classes_found", 0);
    expect(result).toHaveProperty("index_path");
    expect(result).toHaveProperty("test_dir", null);
  });

  it("should invoke computeFunctionIdentity for each parsed function", async () => {
    await createFile("mod.ts");

    mockParseFileAuto.mockResolvedValue({
      file_path: "",
      functions: [{ name: "alpha", params: [], start_line: 1, end_line: 5 }],
      classes: [],
      imports: [],
    });

    await onboardCommand.parseAsync(["onboard", "-p", tmpDir, "--json", "--no-tests"], { from: "user" });

    expect(mockComputeFunctionIdentity).toHaveBeenCalledWith(
      expect.stringContaining("mod.ts"),
      expect.objectContaining({ name: "alpha" })
    );
  });
});
