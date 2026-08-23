import {
  lstat,
  open,
  readFile,
  realpath,
  writeFile,
  mkdir,
  readdir,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type {
  ChangeRecord,
  ReviewSession,
  FileHistory,
  ProjectIndex,
} from "./types.js";
import { projectSession, projectionDigest } from "./projector.js";
import type { ProjectionManifest, ProjectionStorage } from "./projector.js";
import {
  applyManagedGitignore,
  hasManagedGitignoreBlock,
} from "./managed-gitignore.js";

const LOCK_FILE = "history.lock";
const LOCK_TTL_MS = 5 * 60_000;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_RETRY_MS = 25;
const HEARTBEAT_MS = 60_000;
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

interface ProjectLockRecord {
  owner_token: string;
  pid: number;
  heartbeat: string;
}

type AssertLockOwner = () => Promise<void>;

export class ProjectLockTimeoutError extends Error {
  constructor(lockPath: string) {
    super(`Timed out waiting for project lock: ${lockPath}`);
    this.name = "ProjectLockTimeoutError";
  }
}

export class ProjectLockLostError extends Error {
  constructor(lockPath: string) {
    super(`Project lock ownership lost: ${lockPath}`);
    this.name = "ProjectLockLostError";
  }
}

export class PathEscapeError extends Error {
  constructor(filePath: string, reason = "must be a normalized repository-relative path using '/'") {
    super(`PathEscapeError: ${filePath}: ${reason}`);
    this.name = "PathEscapeError";
  }
}

export class StorageRootError extends Error {
  constructor(storagePath: string, reason: string) {
    super(`StorageRootError: ${storagePath}: ${reason}`);
    this.name = "StorageRootError";
  }
}

export class InvalidSessionIdError extends Error {
  constructor(sessionId: string) {
    super(`InvalidSessionIdError: session id must match [A-Za-z0-9][A-Za-z0-9._-]{0,127}: ${sessionId}`);
    this.name = "InvalidSessionIdError";
  }
}

export class SessionConflict extends Error {
  constructor(sessionId: string) {
    super(`SessionConflict: journal already contains a different payload for session id ${sessionId}`);
    this.name = "SessionConflict";
  }
}

export class HistoryWriteError extends Error {
  constructor(path: string, cause: unknown) {
    super(`HistoryWriteError: failed to commit journal file ${path}`, { cause });
    this.name = "HistoryWriteError";
  }
}

export class CorruptSessionError extends Error {
  constructor(path: string, reason: string, cause?: unknown) {
    super(`CorruptSessionError: ${path}: ${reason}`, { cause });
    this.name = "CorruptSessionError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function isWithin(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function logicalPathSegments(filePath: string): string[] {
  if (
    filePath.length === 0
    || filePath.includes("\\")
    || filePath.includes("\0")
    || filePath.startsWith("/")
    || /^[A-Za-z]:/.test(filePath)
    || /^[/\\]{2}/.test(filePath)
  ) {
    throw new PathEscapeError(filePath);
  }

  const segments = filePath.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new PathEscapeError(filePath);
  }
  return segments;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isChangeRecord(value: unknown, sessionId: string): value is ChangeRecord {
  if (value === null || typeof value !== "object") return false;
  const change = value as Record<string, unknown>;
  return typeof change.id === "string"
    && typeof change.timestamp === "string"
    && typeof change.file_path === "string"
    && typeof change.function_hash === "string"
    && typeof change.function_name === "string"
    && isNullableString(change.class_name)
    && ["add", "modify", "delete", "rename"].includes(change.change_type as string)
    && typeof change.reason === "string"
    && ["context", "llm-inferred", "user-provided"].includes(change.reason_source as string)
    && isNullableString(change.old_content)
    && isNullableString(change.new_content)
    && Number.isInteger(change.start_line)
    && Number.isInteger(change.end_line)
    && ["pending", "pass", "fail", "skipped"].includes(change.test_status as string)
    && isNullableString(change.test_file)
    && isNullableString(change.error_id)
    && change.session_id === sessionId;
}

function isReviewSession(value: unknown): value is ReviewSession {
  if (value === null || typeof value !== "object") return false;
  const session = value as Record<string, unknown>;
  return typeof session.id === "string"
    && SESSION_ID_PATTERN.test(session.id)
    && typeof session.timestamp === "string"
    && (session.trigger === "hook" || session.trigger === "cli")
    && typeof session.summary === "string"
    && Number.isInteger(session.total_changes)
    && (session.total_changes as number) >= 0
    && Array.isArray(session.files_changed)
    && session.files_changed.every((path) => typeof path === "string")
    && Array.isArray(session.changes)
    && session.total_changes === session.changes.length
    && session.changes.every((change) => isChangeRecord(change, session.id as string));
}

function isProjectionManifest(value: unknown): value is ProjectionManifest {
  if (value === null || typeof value !== "object") return false;
  const manifest = value as Record<string, unknown>;
  return typeof manifest.dirty === "boolean"
    && Array.isArray(manifest.projected_session_ids)
    && manifest.projected_session_ids.every((id) => typeof id === "string")
    && Number.isInteger(manifest.journal_count)
    && (manifest.journal_count as number) >= 0
    && typeof manifest.journal_hash === "string"
    && typeof manifest.index_digest === "string"
    && Array.isArray(manifest.history_inventory)
    && manifest.history_inventory.every((item) => item !== null
      && typeof item === "object"
      && typeof (item as Record<string, unknown>).path === "string"
      && typeof (item as Record<string, unknown>).digest === "string");
}

async function readLockRecord(lockPath: string): Promise<ProjectLockRecord | null> {
  try {
    const value = JSON.parse(await readFile(lockPath, "utf8")) as Partial<ProjectLockRecord>;
    return typeof value.owner_token === "string"
      && typeof value.pid === "number"
      && typeof value.heartbeat === "string"
      ? value as ProjectLockRecord
      : null;
  } catch {
    return null;
  }
}

async function lockHeartbeatAge(lockPath: string, record: ProjectLockRecord | null): Promise<number> {
  const heartbeat = record ? Date.parse(record.heartbeat) : NaN;
  if (Number.isFinite(heartbeat)) return Date.now() - heartbeat;
  try {
    return Date.now() - (await stat(lockPath)).mtimeMs;
  } catch {
    return 0;
  }
}

async function reclaimExpiredLock(lockPath: string): Promise<boolean> {
  const observed = await readLockRecord(lockPath);
  if (await lockHeartbeatAge(lockPath, observed) <= LOCK_TTL_MS) return false;

  // PID state is diagnostic only. A reused PID or EPERM must not override an
  // expired heartbeat lease and leave the project permanently locked.
  if (observed?.pid) {
    try {
      process.kill(observed.pid, 0);
    } catch {
      // Heartbeat expiry remains authoritative.
    }
  }

  const current = await readLockRecord(lockPath);
  if (observed?.owner_token !== current?.owner_token || observed?.heartbeat !== current?.heartbeat) {
    return false;
  }

  const stalePath = join(dirname(lockPath), `.history.lock.stale-${randomUUID()}`);
  try {
    await rename(lockPath, stalePath);
    await unlink(stalePath).catch(() => undefined);
    return true;
  } catch (error) {
    if (isCode(error, "ENOENT") || isCode(error, "EACCES") || isCode(error, "EPERM")) return false;
    throw error;
  }
}

/** Serialize one project's history writes across processes using a fenced lockfile. */
export async function withProjectLock<T>(
  storageRoot: string,
  operation: (assertOwner: AssertLockOwner) => Promise<T>,
): Promise<T> {
  await mkdir(storageRoot, { recursive: true });
  const lockPath = join(storageRoot, LOCK_FILE);
  const ownerToken = randomUUID();
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let handle: Awaited<ReturnType<typeof open>>;

  while (true) {
    try {
      handle = await open(lockPath, "wx", 0o600);
      break;
    } catch (error) {
      if (!isCode(error, "EEXIST")) throw error;
      await reclaimExpiredLock(lockPath);
      if (Date.now() >= deadline) throw new ProjectLockTimeoutError(lockPath);
      await sleep(LOCK_RETRY_MS);
    }
  }

  let lost = false;
  const writeHeartbeat = async (): Promise<void> => {
    const bytes = Buffer.from(JSON.stringify({
      owner_token: ownerToken,
      pid: process.pid,
      heartbeat: new Date().toISOString(),
    } satisfies ProjectLockRecord));
    await handle.write(bytes, 0, bytes.length, 0);
    await handle.truncate(bytes.length);
    await handle.sync();
  };
  await writeHeartbeat();

  const assertOwner: AssertLockOwner = async () => {
    if (lost || (await readLockRecord(lockPath))?.owner_token !== ownerToken) {
      throw new ProjectLockLostError(lockPath);
    }
  };
  const heartbeat = setInterval(() => {
    assertOwner()
      .then(writeHeartbeat)
      .catch(() => { lost = true; });
  }, HEARTBEAT_MS);
  heartbeat.unref();

  try {
    await assertOwner();
    return await operation(assertOwner);
  } finally {
    clearInterval(heartbeat);
    const stillOwner = !lost && (await readLockRecord(lockPath))?.owner_token === ownerToken;
    await handle.close();
    if (stillOwner) await unlink(lockPath).catch(() => undefined);
  }
}

export class HistoryStore {
  private projectRoot: string;
  private root: string;
  private reviewsDir: string;
  private historyDir: string;
  private indexPath: string;

  constructor(projectRoot: string) {
    this.projectRoot = resolve(projectRoot);
    this.root = join(this.projectRoot, ".devcompanion");
    this.reviewsDir = join(this.root, "reviews");
    this.historyDir = join(this.root, "history");
    this.indexPath = join(this.root, "index.json");
  }

  async init(): Promise<void> {
    try {
      this.projectRoot = await realpath(this.projectRoot);
    } catch {
      throw new StorageRootError(this.projectRoot, "project root does not exist");
    }
    this.root = join(this.projectRoot, ".devcompanion");
    this.reviewsDir = join(this.root, "reviews");
    this.historyDir = join(this.root, "history");
    this.indexPath = join(this.root, "index.json");

    await this.ensureTrustedDirectory(this.root);
    await this.ensureTrustedDirectory(this.reviewsDir);
    await this.ensureTrustedDirectory(this.historyDir);

    if (!existsSync(this.indexPath)) {
      const index: ProjectIndex = {
        project_root: dirname(this.root),
        last_updated: new Date().toISOString(),
        total_sessions: 0,
        total_changes: 0,
        function_index: {},
      };
      await this.writeJson(this.indexPath, index);
    }

    await this.ensureGitignore();
    await this.ensureProjectionHealthy();
  }

  async saveSession(session: ReviewSession): Promise<string> {
    if (!SESSION_ID_PATTERN.test(session.id)) {
      throw new InvalidSessionIdError(session.id);
    }
    for (const change of session.changes) this.fileHistoryPath(change.file_path);
    await this.assertStorageRoots();
    return withProjectLock(this.root, async (assertOwner) => {
      await this.assertStorageRoots();
      const suffix = `~${session.id}.json`;
      const existingName = (await readdir(this.reviewsDir)).find((name) => name.endsWith(suffix));
      let filepath: string;

      if (existingName) {
        filepath = join(this.reviewsDir, existingName);
        const existing = await this.readJson<ReviewSession>(filepath);
        const canonicalInput = JSON.parse(JSON.stringify(session)) as ReviewSession;
        if (!isDeepStrictEqual(existing, canonicalInput)) throw new SessionConflict(session.id);
      } else {
        const timestamp = session.timestamp
          .replace(/[^A-Za-z0-9_-]+/g, "-")
          .replace(/^-+|-+$/g, "") || "undated";
        filepath = join(this.reviewsDir, `${timestamp}${suffix}`);
        try {
          await this.atomicWriteJson(filepath, session, assertOwner);
        } catch (cause) {
          throw new HistoryWriteError(filepath, cause);
        }
      }

      await projectSession(session, this.projectionStorage(assertOwner));
      return filepath;
    });
  }

  async getFileHistory(filePath: string): Promise<FileHistory | null> {
    const historyPath = this.fileHistoryPath(filePath);
    await this.ensureProjectionHealthy();
    if (!existsSync(historyPath)) return null;
    await this.assertHistoryTarget(historyPath);
    return this.readJson<FileHistory>(historyPath);
  }

  async getFunctionHistory(functionHash: string): Promise<ChangeRecord[]> {
    const index = await this.getIndex();
    const entry = index.function_index[functionHash];
    if (!entry) return [];

    const fileHistory = await this.getFileHistory(entry.file_path);
    if (!fileHistory) return [];

    return fileHistory.functions[functionHash]?.records ?? [];
  }

  async getIndex(): Promise<ProjectIndex> {
    await this.ensureProjectionHealthy();
    return this.readJson<ProjectIndex>(this.indexPath);
  }

  async rebuildDerivedHistory(): Promise<void> {
    await this.rebuildProjection(true);
  }

  async writeIndex(index: ProjectIndex): Promise<void> {
    await this.writeJson(this.indexPath, index);
  }

  async listSessions(limit = 20): Promise<string[]> {
    const files = await readdir(this.reviewsDir);
    return files
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, limit);
  }

  async getSession(filename: string): Promise<ReviewSession> {
    return this.readJson<ReviewSession>(join(this.reviewsDir, filename));
  }

  private fileHistoryPath(filePath: string): string {
    const target = `${join(this.historyDir, ...logicalPathSegments(filePath))}.json`;
    if (!isWithin(this.historyDir, target)) {
      throw new PathEscapeError(filePath, "history output escapes .devcompanion/history");
    }
    return target;
  }

  private async ensureTrustedDirectory(storagePath: string): Promise<void> {
    if (existsSync(storagePath)) {
      const info = await lstat(storagePath);
      if (info.isSymbolicLink()) {
        throw new StorageRootError(storagePath, "storage root is a symlink or junction");
      }
      if (!info.isDirectory()) {
        throw new StorageRootError(storagePath, "storage root is not a directory");
      }
    } else {
      await mkdir(storagePath, { recursive: true });
    }

    const canonical = await realpath(storagePath);
    if (!isWithin(this.projectRoot, canonical)) {
      throw new StorageRootError(storagePath, "storage root resolves outside the project");
    }
  }

  private async assertStorageRoots(): Promise<void> {
    await this.ensureTrustedDirectory(this.root);
    await this.ensureTrustedDirectory(this.reviewsDir);
    await this.ensureTrustedDirectory(this.historyDir);
  }

  private async assertHistoryTarget(historyPath: string): Promise<void> {
    const canonicalHistory = await realpath(this.historyDir);
    const canonicalParent = await realpath(dirname(historyPath));
    if (
      !isWithin(this.projectRoot, canonicalHistory)
      || !isWithin(canonicalHistory, canonicalParent)
    ) {
      throw new StorageRootError(historyPath, "history output resolves outside .devcompanion/history");
    }
    if (existsSync(historyPath) && (await lstat(historyPath)).isSymbolicLink()) {
      throw new StorageRootError(historyPath, "history output is a symlink or junction");
    }
  }

  private projectionStorage(assertOwner: AssertLockOwner): ProjectionStorage {
    const manifestPath = join(this.root, "projection-manifest.json");
    return {
      readManifest: async () => existsSync(manifestPath)
        ? this.readJson<ProjectionManifest>(manifestPath)
        : null,
      writeManifest: (manifest) => this.atomicWriteJson(manifestPath, manifest, assertOwner),
      readIndex: () => this.readJson<ProjectIndex>(this.indexPath),
      writeIndex: (index) => this.atomicWriteJson(this.indexPath, index, assertOwner),
      readFileHistory: async (filePath) => {
        const path = this.fileHistoryPath(filePath);
        if (!existsSync(path)) return null;
        await this.assertHistoryTarget(path);
        return this.readJson<FileHistory>(path);
      },
      writeFileHistory: async (filePath, history) => {
        const path = this.fileHistoryPath(filePath);
        await mkdir(dirname(path), { recursive: true });
        await this.assertHistoryTarget(path);
        await this.atomicWriteJson(path, history, assertOwner);
      },
    };
  }

  private async ensureProjectionHealthy(): Promise<void> {
    if (!(await this.isProjectionHealthy())) await this.rebuildProjection(false);
  }

  private async rebuildProjection(always: boolean): Promise<void> {
    await this.assertStorageRoots();
    await withProjectLock(this.root, async (assertOwner) => {
      await this.assertStorageRoots();
      if (!always && await this.isProjectionHealthy()) return;

      const sessions = await this.readJournalSessions();
      const storage = this.projectionStorage(assertOwner);
      const zeroIndex: ProjectIndex = {
        project_root: this.projectRoot,
        last_updated: "",
        total_sessions: 0,
        total_changes: 0,
        function_index: {},
      };
      let manifest: ProjectionManifest = {
        dirty: false,
        projected_session_ids: [],
        journal_count: 0,
        journal_hash: projectionDigest([]),
        index_digest: projectionDigest(zeroIndex),
        history_inventory: [],
      };
      await storage.writeManifest({ ...manifest, dirty: true });
      await storage.writeIndex(zeroIndex);

      const written = new Set<string>();
      const rebuildStorage: ProjectionStorage = {
        ...storage,
        readManifest: async () => structuredClone(manifest),
        writeManifest: async (next) => { manifest = structuredClone(next); },
        readFileHistory: async (filePath) => written.has(filePath)
          ? storage.readFileHistory(filePath)
          : null,
        writeFileHistory: async (filePath, history) => {
          await storage.writeFileHistory(filePath, history);
          written.add(filePath);
        },
      };
      for (const session of sessions) {
        manifest = await projectSession(session, rebuildStorage);
      }

      const expected = new Set(manifest.history_inventory.map((item) =>
        this.storagePathKey(this.fileHistoryPath(item.path))));
      for (const path of await this.historyFiles()) {
        if (!expected.has(this.storagePathKey(path))) {
          await this.assertHistoryTarget(path);
          await assertOwner();
          await unlink(path);
        }
      }
      await storage.writeManifest({ ...manifest, dirty: false });
    });
  }

  private async isProjectionHealthy(): Promise<boolean> {
    try {
      const manifestPath = join(this.root, "projection-manifest.json");
      if (!existsSync(manifestPath) || !existsSync(this.indexPath)) return false;
      const manifestValue = await this.readJson<unknown>(manifestPath);
      if (!isProjectionManifest(manifestValue) || manifestValue.dirty) return false;
      const manifest = manifestValue;
      const sessions = await this.readJournalSessions();
      if (manifest.journal_count !== sessions.length) return false;

      let journalHash = projectionDigest([]);
      for (const session of sessions) journalHash = projectionDigest([journalHash, session]);
      if (manifest.journal_hash !== journalHash) return false;
      if (!isDeepStrictEqual(
        manifest.projected_session_ids,
        sessions.map((session) => session.id).sort(),
      )) return false;

      const index = await this.readJson<unknown>(this.indexPath);
      if (manifest.index_digest !== projectionDigest(index)) return false;
      const sortedInventory = [...manifest.history_inventory]
        .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
      if (!isDeepStrictEqual(manifest.history_inventory, sortedInventory)) return false;
      if (new Set(sortedInventory.map((item) => item.path)).size !== sortedInventory.length) {
        return false;
      }

      const expectedPaths = sortedInventory.map((item) =>
        this.storagePathKey(this.fileHistoryPath(item.path))).sort();
      const actualPaths = (await this.historyFiles()).map((path) => this.storagePathKey(path)).sort();
      if (!isDeepStrictEqual(actualPaths, expectedPaths)) return false;
      for (const item of sortedInventory) {
        const path = this.fileHistoryPath(item.path);
        await this.assertHistoryTarget(path);
        if (item.digest !== projectionDigest(await this.readJson<unknown>(path))) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  private async readJournalSessions(): Promise<ReviewSession[]> {
    const byId = new Map<string, ReviewSession>();
    const entries = (await readdir(this.reviewsDir, { withFileTypes: true }))
      .filter((entry) => entry.name.endsWith(".json"))
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const path = join(this.reviewsDir, entry.name);
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new CorruptSessionError(path, "journal entry is not a regular file");
      }
      let value: unknown;
      try {
        value = await this.readJson<unknown>(path);
      } catch (cause) {
        throw new CorruptSessionError(path, "journal entry is not valid JSON", cause);
      }
      if (!isReviewSession(value)) {
        throw new CorruptSessionError(path, "journal entry does not match ReviewSession schema");
      }
      try {
        for (const filePath of [...value.files_changed, ...value.changes.map((c) => c.file_path)]) {
          this.fileHistoryPath(filePath);
        }
      } catch (cause) {
        throw new CorruptSessionError(path, "journal contains an invalid repository path", cause);
      }

      const existing = byId.get(value.id);
      if (existing && !isDeepStrictEqual(existing, value)) {
        throw new CorruptSessionError(path, `conflicting journal payload for session id ${value.id}`);
      }
      if (!existing) byId.set(value.id, value);
    }
    return [...byId.values()];
  }

  private async historyFiles(directory = this.historyDir): Promise<string[]> {
    const files: string[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new StorageRootError(path, "history projection is a symlink or junction");
      }
      if (entry.isDirectory()) files.push(...await this.historyFiles(path));
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(path);
    }
    return files;
  }

  private storagePathKey(path: string): string {
    const absolute = resolve(path);
    return process.platform === "win32" ? absolute.toLowerCase() : absolute;
  }

  private async atomicWriteJson(
    path: string,
    data: unknown,
    assertOwner: AssertLockOwner,
  ): Promise<void> {
    const tempPath = join(dirname(path), `.${randomUUID()}.tmp`);
    const handle = await open(tempPath, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(data, null, 2) + "\n", "utf8");
      await handle.sync();
      await assertOwner();
      await handle.close();
      for (let attempt = 0; ; attempt++) {
        try {
          await rename(tempPath, path);
          break;
        } catch (error) {
          const transientWindowsReplace = process.platform === "win32"
            && (isCode(error, "EPERM") || isCode(error, "EACCES"));
          if (!transientWindowsReplace || attempt >= 5) throw error;
          await sleep(10 * 2 ** attempt);
          await assertOwner();
        }
      }
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }
  }

  private async ensureGitignore(): Promise<void> {
    // 3a: one policy with the installer. If the managed block is present, skip
    // (installer owns visibility-aware rules). Otherwise write the tests-preserving
    // pattern — never blanket `.devcompanion/` which hides `.devcompanion/tests/`.
    const gitignorePath = join(dirname(this.root), ".gitignore");
    const existing = existsSync(gitignorePath)
      ? await readFile(gitignorePath, "utf-8")
      : "";
    if (hasManagedGitignoreBlock(existing)) return;
    const next = applyManagedGitignore(existing, "init");
    if (next !== existing) {
      await writeFile(gitignorePath, next);
    }
  }

  private async readJson<T>(path: string): Promise<T> {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content) as T;
  }

  private async writeJson(path: string, data: unknown): Promise<void> {
    await writeFile(path, JSON.stringify(data, null, 2) + "\n");
  }
}
