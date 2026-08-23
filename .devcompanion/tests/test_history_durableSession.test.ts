import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import {
  existsSync,
} from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as historyModule from "../../packages/history/src/index.js";
import * as historyStoreModule from "../../packages/history/src/store.js";
import type {
  FileHistory,
  ProjectIndex,
  ProjectionManifest,
  ProjectionStorage,
  ReviewSession,
} from "../../packages/history/src/index.js";

const HISTORY_MODULE_URL = new URL("../../packages/history/src/index.ts", import.meta.url).href;
const WORKSPACE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FIXED_TIME = "2026-08-17T12:00:00.000Z";
const childWriter = String.raw`
  import { existsSync } from "node:fs";
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  while (!existsSync(process.env.AIDEV_TEST_BARRIER)) await wait(5);
  const history = await import(process.env.AIDEV_HISTORY_MODULE_URL);
  if (typeof history.HistoryStore !== "function") throw new Error("HistoryStore export missing");
  const store = new history.HistoryStore(process.env.AIDEV_TEST_PROJECT_ROOT);
  await store.init();
  await store.saveSession(JSON.parse(process.env.AIDEV_TEST_SESSION));
`;

const tempRoots: string[] = [];

async function tempRoot(prefix = "history-contract-"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function makeSession(id: string, filePath = `src/${id}.ts`): ReviewSession {
  return {
    id,
    timestamp: FIXED_TIME,
    trigger: "hook",
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
      reason: "contract test",
      reason_source: "context",
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

function memoryProjectionStorage(failHistoryWrite = false): {
  storage: ProjectionStorage;
  state: {
    manifest: ProjectionManifest | null;
    index: ProjectIndex;
    histories: Map<string, FileHistory>;
  };
} {
  const state = {
    manifest: null as ProjectionManifest | null,
    index: {
      project_root: "/project",
      last_updated: "",
      total_sessions: 0,
      total_changes: 0,
      function_index: {},
    },
    histories: new Map<string, FileHistory>(),
  };
  const storage: ProjectionStorage = {
    readManifest: async () => structuredClone(state.manifest),
    writeManifest: async (manifest) => { state.manifest = structuredClone(manifest); },
    readIndex: async () => structuredClone(state.index),
    writeIndex: async (index) => { state.index = structuredClone(index); },
    readFileHistory: async (filePath) => structuredClone(state.histories.get(filePath) ?? null),
    writeFileHistory: async (filePath, history) => {
      if (failHistoryWrite) throw new Error("injected history write failure");
      state.histories.set(filePath, structuredClone(history));
    },
  };
  return { storage, state };
}

function storeFor(root: string): historyModule.HistoryStore {
  expect(typeof historyModule.HistoryStore).toBe("function");
  return new historyModule.HistoryStore(root);
}

function requireStoreMethod<T extends (...args: never[]) => unknown>(
  store: historyModule.HistoryStore,
  name: string,
): T {
  const method = (store as unknown as Record<string, unknown>)[name];
  expect(method, `HistoryStore.${name} must exist`).toBeTypeOf("function");
  return (method as T).bind(store);
}

async function journalFiles(root: string): Promise<string[]> {
  return (await readdir(join(root, ".devcompanion", "reviews")))
    .filter((name) => name.endsWith(".json"));
}

function runChildWriter(root: string, barrier: string, session: ReviewSession): Promise<void> {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", childWriter],
    {
      cwd: WORKSPACE_ROOT,
      env: {
        ...process.env,
        AIDEV_HISTORY_MODULE_URL: HISTORY_MODULE_URL,
        AIDEV_TEST_BARRIER: barrier,
        AIDEV_TEST_PROJECT_ROOT: root,
        AIDEV_TEST_SESSION: JSON.stringify(session),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`child writer exited ${code}: ${stderr}`));
    });
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

export const historyJournalContractTests = describe("HistoryStore durable journal contract", () => {
  it("[FN-018] projects the same session id only once", async () => {
    const projectSession = historyModule.projectSession;
    expect(projectSession).toBeTypeOf("function");
    const memory = memoryProjectionStorage();
    const session = makeSession("project-once", "src/app.ts");

    await projectSession(session, memory.storage);
    const manifest = await projectSession(structuredClone(session), memory.storage);

    expect(memory.state.index.total_sessions).toBe(1);
    expect(memory.state.histories.get("src/app.ts")?.total_records).toBe(1);
    expect(manifest).toMatchObject({ dirty: false, journal_count: 1 });
    expect(manifest.projected_session_ids).toEqual([session.id]);
  });

  it("[FN-018] leaves the manifest dirty when a history write fails after index", async () => {
    const projectSession = historyModule.projectSession;
    expect(projectSession).toBeTypeOf("function");
    const memory = memoryProjectionStorage(true);
    const session = makeSession("projection-failure", "src/failure.ts");
    const journalInput = structuredClone(session);

    await expect(projectSession(session, memory.storage)).rejects.toMatchObject({
      name: "ProjectionError",
    });

    expect(memory.state.index.total_sessions).toBe(1);
    expect(memory.state.histories.size).toBe(0);
    expect(memory.state.manifest?.dirty).toBe(true);
    expect(session).toEqual(journalInput);
  });

  it("[FN-009] does not overwrite sessions with identical timestamps", async () => {
    const root = await tempRoot();
    const store = storeFor(root);
    await store.init();

    await store.saveSession(makeSession("session-a"));
    await store.saveSession(makeSession("session-b"));

    expect(await journalFiles(root)).toHaveLength(2);
    expect((await store.getIndex()).total_sessions).toBe(2);
  });

  it("[FN-009] is idempotent for an identical session id and rejects conflicting payloads", async () => {
    const root = await tempRoot();
    const store = storeFor(root);
    const session = makeSession("stable-id");
    await store.init();

    await store.saveSession(session);
    await store.saveSession(structuredClone(session));
    expect(await journalFiles(root)).toHaveLength(1);
    expect((await store.getIndex()).total_sessions).toBe(1);

    await expect(store.saveSession({ ...session, summary: "mutated payload" }))
      .rejects.toThrow(/SessionConflict|same.*id|conflict/i);
  });

  it("[FN-010] repairs projections when the manifest is dirty", async () => {
    const root = await tempRoot();
    const store = storeFor(root);
    await store.init();
    await store.saveSession(makeSession("dirty-manifest"));

    const manifestPath = join(root, ".devcompanion", "projection-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    await writeFile(manifestPath, JSON.stringify({ ...manifest, dirty: true }));

    const rebuild = requireStoreMethod<() => Promise<void>>(store, "rebuildDerivedHistory");
    await rebuild();

    expect(JSON.parse(await readFile(manifestPath, "utf8"))).toMatchObject({ dirty: false });
    expect((await store.getIndex()).total_sessions).toBe(1);
  });

  it("[FN-011] resolves repository-relative paths from projectRoot and rejects path escape", async () => {
    const root = await tempRoot();
    const unrelatedCwd = await tempRoot("history-cwd-");
    const originalCwd = process.cwd();
    const store = storeFor(root);
    await store.init();

    try {
      process.chdir(unrelatedCwd);
      await store.saveSession(makeSession("cwd-safe", "src/nested/app.ts"));
      expect(await store.getFileHistory("src/nested/app.ts")).not.toBeNull();
      await expect(store.saveSession(makeSession("escape", "../outside.ts")))
        .rejects.toThrow(/PathEscape|outside|relative|escape/i);
    } finally {
      process.chdir(originalCwd);
    }

    expect(existsSync(join(root, ".devcompanion", "history", "src", "nested", "app.ts.json"))).toBe(true);
  });

  it("[FN-009] serializes real child-process writers without losing sessions", async () => {
    const root = await tempRoot();
    const barrier = join(root, "start-writers");
    const store = storeFor(root);
    await store.init();

    const writers = Array.from({ length: 6 }, (_, index) =>
      runChildWriter(root, barrier, makeSession(`child-${index}`)));
    await writeFile(barrier, "go");
    await Promise.all(writers);

    expect(await journalFiles(root)).toHaveLength(6);
    expect((await store.getIndex()).total_sessions).toBe(6);
  });

  it("[FN-008] recovers an expired lock despite PID reuse or EPERM and respects fencing", async () => {
    const root = await tempRoot();
    const storageRoot = join(root, ".devcompanion");
    await mkdir(storageRoot, { recursive: true });
    const lockPath = join(storageRoot, "history.lock");
    await writeFile(lockPath, JSON.stringify({
      owner_token: "expired-owner",
      pid: process.pid,
      heartbeat: "2000-01-01T00:00:00.000Z",
    }));
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("not permitted"), { code: "EPERM" });
    });

    const withProjectLock = (historyStoreModule as Record<string, unknown>).withProjectLock;
    expect(withProjectLock).toBeTypeOf("function");
    await (withProjectLock as <T>(
      root: string,
      operation: (assertOwner: () => Promise<void>) => Promise<T>,
    ) => Promise<T>)(storageRoot, async (assertOwner) => {
      await assertOwner();
      await writeFile(lockPath, JSON.stringify({
        owner_token: "replacement-owner",
        pid: process.pid,
        heartbeat: new Date().toISOString(),
      }));
      await expect(assertOwner()).rejects.toThrow(/ownership lost|lock.*lost/i);
    });

    expect(JSON.parse(await readFile(lockPath, "utf8"))).toMatchObject({
      owner_token: "replacement-owner",
    });
  });

  it("[FN-010] repairs a valid-JSON index whose digest no longer matches", async () => {
    const root = await tempRoot();
    const store = storeFor(root);
    await store.init();
    await store.saveSession(makeSession("digest-check"));
    const indexPath = join(root, ".devcompanion", "index.json");
    const index = JSON.parse(await readFile(indexPath, "utf8"));
    await writeFile(indexPath, JSON.stringify({ ...index, total_sessions: 999 }));

    expect((await store.getIndex()).total_sessions).toBe(1);
  });

  it("[FN-010] rebuilds a missing file-history projection from the journal", async () => {
    const root = await tempRoot();
    const store = storeFor(root);
    await store.init();
    await store.saveSession(makeSession("missing-history", "src/app.ts"));
    const historyPath = join(root, ".devcompanion", "history", "src", "app.ts.json");
    await rm(historyPath);

    const repaired = await store.getFileHistory("src/app.ts");

    expect(repaired?.total_records).toBe(1);
    expect(existsSync(historyPath)).toBe(true);
  });

  it("[FN-011] rejects a storage-root junction that redirects outside the project", async () => {
    const root = await tempRoot();
    const outside = await tempRoot("history-outside-");
    const storageRoot = join(root, ".devcompanion");
    await mkdir(outside, { recursive: true });
    await symlink(outside, storageRoot, process.platform === "win32" ? "junction" : "dir");

    await expect(storeFor(root).init()).rejects.toThrow(/junction|symlink|storage|outside|escape/i);
    expect(await readdir(outside)).toEqual([]);
  });
});
