import { basename, join } from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HistoryStore } from "../../packages/history/src/store.js";
import type { ProjectIndex, ReviewSession } from "../../packages/history/src/types.js";

const FIXED_TIME = "2026-08-17T12:00:00.000Z";

function makeSession(id: string, filePath = "src/test.ts"): ReviewSession {
  return {
    id,
    timestamp: FIXED_TIME,
    trigger: "cli",
    summary: `session ${id}`,
    total_changes: 1,
    files_changed: [filePath],
    changes: [{
      id: `${id}-record`,
      timestamp: FIXED_TIME,
      file_path: filePath,
      function_hash: `hash-${id}`,
      function_name: `fn_${id}`,
      class_name: null,
      change_type: "modify",
      reason: "HistoryStore API smoke",
      reason_source: "user-provided",
      old_content: "before",
      new_content: "after",
      start_line: 1,
      end_line: 1,
      test_status: "pending",
      test_file: null,
      error_id: null,
      session_id: id,
    }],
  };
}

describe("HistoryStore", () => {
  let projectRoot: string;
  let store: HistoryStore;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "history-store-api-"));
    store = new HistoryStore(projectRoot);
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("initializes trusted storage directories", async () => {
    await store.init();
    await expect(readFile(join(projectRoot, ".devcompanion", "index.json"), "utf8"))
      .resolves.toContain('"total_sessions": 0');
    await expect(readFile(join(projectRoot, ".devcompanion", "projection-manifest.json"), "utf8"))
      .resolves.toContain('"dirty": false');
  });

  it("is idempotent across repeated init", async () => {
    await store.init();
    const first = await store.getIndex();
    await store.init();
    expect(await store.getIndex()).toEqual(first);
  });

  it("returns null for missing file history", async () => {
    await store.init();
    await expect(store.getFileHistory("src/missing.ts")).resolves.toBeNull();
  });

  it("reads file history after saving a session", async () => {
    await store.init();
    await store.saveSession(makeSession("file-history"));
    const history = await store.getFileHistory("src/test.ts");
    expect(history?.total_records).toBe(1);
    expect(history?.functions["hash-file-history"].records).toHaveLength(1);
  });

  it("returns an empty function history for an unknown hash", async () => {
    await store.init();
    await expect(store.getFunctionHistory("unknown")).resolves.toEqual([]);
  });

  it("returns the projected index", async () => {
    await store.init();
    await store.saveSession(makeSession("index"));
    await expect(store.getIndex()).resolves.toMatchObject({
      project_root: projectRoot,
      total_sessions: 1,
      total_changes: 1,
    });
  });

  it("returns the same healthy index on repeated reads", async () => {
    await store.init();
    const first = await store.getIndex();
    expect(await store.getIndex()).toEqual(first);
  });

  it("writeIndex writes the requested JSON", async () => {
    await store.init();
    const index: ProjectIndex = {
      project_root: projectRoot,
      last_updated: FIXED_TIME,
      total_sessions: 3,
      total_changes: 4,
      function_index: {},
    };
    await store.writeIndex(index);
    expect(JSON.parse(await readFile(join(projectRoot, ".devcompanion", "index.json"), "utf8")))
      .toEqual(index);
  });

  it("reads an immutable session by filename", async () => {
    await store.init();
    const session = makeSession("read-session");
    const path = await store.saveSession(session);
    await expect(store.getSession(basename(path))).resolves.toEqual(session);
  });

  it("handles concurrent healthy reads", async () => {
    await store.init();
    const results = await Promise.all([store.getIndex(), store.getIndex(), store.getIndex()]);
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual(results[1]);
  });

  it("repairs a valid-JSON index that disagrees with the journal", async () => {
    await store.init();
    await store.saveSession(makeSession("repair"));
    const indexPath = join(projectRoot, ".devcompanion", "index.json");
    const index = JSON.parse(await readFile(indexPath, "utf8"));
    await writeFile(indexPath, JSON.stringify({ ...index, total_sessions: 99 }));
    expect((await store.getIndex()).total_sessions).toBe(1);
  });
});
