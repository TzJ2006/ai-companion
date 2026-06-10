import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ReviewSession, FileHistory, ProjectIndex } from "../../packages/history/src/types.js";

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();
const mockExistsSync = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: (...args: any[]) => mockReadFile(...args),
  writeFile: (...args: any[]) => mockWriteFile(...args),
  mkdir: (...args: any[]) => mockMkdir(...args),
}));

vi.mock("node:fs", () => ({
  existsSync: (...args: any[]) => mockExistsSync(...args),
}));

const { HistoryStore } = await import("../../packages/history/src/store.js");

describe("HistoryStore", () => {
  let instance: InstanceType<typeof HistoryStore>;
  const projectRoot = "test-project";

  beforeEach(() => {
    vi.clearAllMocks();
    instance = new HistoryStore(projectRoot);
  });

  describe("init", () => {
    it("should create directories", async () => {
      mockExistsSync.mockReturnValue(false);
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      await instance.init();
      expect(mockMkdir).toHaveBeenCalled();
    });

    it("should create index.json", async () => {
      mockExistsSync.mockReturnValue(false);
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      await instance.init();
      const call = mockWriteFile.mock.calls.find((c: any[]) => c[0].includes("index.json"));
      expect(call).toBeDefined();
    });

    it("should not overwrite existing index", async () => {
      mockExistsSync.mockReturnValue(true);
      mockMkdir.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue("*.json\n");
      await instance.init();
      const calls = mockWriteFile.mock.calls.filter((c: any[]) => c[0].includes("index.json"));
      expect(calls.length).toBe(0);
    });
  });

  describe("getFileHistory", () => {
    it("should return null if not found", async () => {
      mockExistsSync.mockReturnValue(false);
      const result = await instance.getFileHistory("src/test.ts");
      expect(result).toBeNull();
    });

    it("should return history if exists", async () => {
      mockExistsSync.mockReturnValue(true);
      const history: FileHistory = {
        file_path: "src/test.ts",
        last_updated: new Date().toISOString(),
        total_records: 0,
        functions: {},
      };
      mockReadFile.mockResolvedValue(JSON.stringify(history));
      const result = await instance.getFileHistory("src/test.ts");
      expect(result).toEqual(history);
    });
  });

  describe("getFunctionHistory", () => {
    it("should return empty array if not indexed", async () => {
      mockExistsSync.mockReturnValue(true);
      const index: ProjectIndex = {
        project_root: projectRoot,
        last_updated: new Date().toISOString(),
        total_sessions: 0,
        total_changes: 0,
        function_index: {},
      };
      mockReadFile.mockResolvedValue(JSON.stringify(index));
      const result = await instance.getFunctionHistory("unknown");
      expect(result).toEqual([]);
    });
  });

  describe("getIndex", () => {
    it("should return index", async () => {
      const index: ProjectIndex = {
        project_root: projectRoot,
        last_updated: new Date().toISOString(),
        total_sessions: 5,
        total_changes: 20,
        function_index: {},
      };
      mockReadFile.mockResolvedValue(JSON.stringify(index));
      const result = await instance.getIndex();
      expect(result).toEqual(index);
    });

    it("should be idempotent", async () => {
      const index: ProjectIndex = {
        project_root: projectRoot,
        last_updated: new Date().toISOString(),
        total_sessions: 5,
        total_changes: 20,
        function_index: {},
      };
      mockReadFile.mockResolvedValue(JSON.stringify(index));
      const r1 = await instance.getIndex();
      const r2 = await instance.getIndex();
      expect(r1).toEqual(r2);
    });
  });

  describe("writeIndex", () => {
    it("should write to file", async () => {
      mockWriteFile.mockResolvedValue(undefined);
      const index: ProjectIndex = {
        project_root: projectRoot,
        last_updated: new Date().toISOString(),
        total_sessions: 1,
        total_changes: 5,
        function_index: {},
      };
      await instance.writeIndex(index);
      expect(mockWriteFile).toHaveBeenCalled();
    });
  });

  describe("getSession", () => {
    it("should return session data", async () => {
      const session: ReviewSession = {
        id: "s1",
        timestamp: "2024-05-15T10:00:00Z",
        trigger: "cli",
        summary: "test",
        total_changes: 1,
        files_changed: ["f1.ts"],
        changes: [],
      };
      mockReadFile.mockResolvedValue(JSON.stringify(session));
      const result = await instance.getSession("file.json");
      expect(result).toEqual(session);
    });
  });

  describe("edge cases", () => {
    it("handles concurrent operations", async () => {
      mockExistsSync.mockReturnValue(true);
      const index: ProjectIndex = {
        project_root: projectRoot,
        last_updated: new Date().toISOString(),
        total_sessions: 1,
        total_changes: 1,
        function_index: {},
      };
      mockReadFile.mockResolvedValue(JSON.stringify(index));
      const results = await Promise.all([instance.getIndex(), instance.getIndex(), instance.getIndex()]);
      expect(results).toHaveLength(3);
      expect(results[0]).toEqual(results[1]);
    });
  });
});
