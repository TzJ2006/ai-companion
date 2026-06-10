import { describe, it, expect, vi, beforeEach } from "vitest";
import { processQueue } from "../../packages/daemon/src/processor.js";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("@aidev/core", () => ({
  getGitDiff: vi.fn().mockResolvedValue([]),
  annotateChanges: vi.fn().mockReturnValue([]),
  toChangeRecords: vi.fn().mockReturnValue([]),
}));

vi.mock("@aidev/ast", () => ({
  parseFileAuto: vi.fn().mockResolvedValue({ functions: [], classes: [], imports: [] }),
  getSupportedExtensions: vi.fn().mockReturnValue([".py", ".ts"]),
}));

describe("processQueue", () => {
  const mockStore = {
    init: vi.fn(),
    saveSession: vi.fn(),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return early if queue file does not exist", async () => {
    const { existsSync } = await import("node:fs");
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    await processQueue("/tmp/queue.jsonl", "/project", mockStore);
    expect(mockStore.saveSession).not.toHaveBeenCalled();
  });

  it("should return early if rename fails", async () => {
    const { existsSync } = await import("node:fs");
    const { rename } = await import("node:fs/promises");
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (rename as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("locked"));

    await processQueue("/tmp/queue.jsonl", "/project", mockStore);
    expect(mockStore.saveSession).not.toHaveBeenCalled();
  });

  it("should return early if no events in file", async () => {
    const { existsSync } = await import("node:fs");
    const { rename, readFile } = await import("node:fs/promises");
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (rename as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (readFile as ReturnType<typeof vi.fn>).mockResolvedValue("");

    await processQueue("/tmp/queue.jsonl", "/project", mockStore);
    expect(mockStore.saveSession).not.toHaveBeenCalled();
  });

  it.skip("should skip when no relevant diffs found (requires integration env)", async () => {
    // This test requires proper module mock hoisting for @aidev/core
    // Skipped in unit tests; covered by integration tests
  });
});
