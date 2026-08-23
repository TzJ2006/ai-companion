import { constants, createReadStream, type Stats } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  opendir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { HistoryStore } from "@aidev/history";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SCAN_FILE_BUDGET = 128;
const SCAN_TIME_BUDGET_MS = 1000;
const EVENT_READ_LIMIT = 256 * 1024;
const SNAPSHOT_READ_LIMIT = 2 * 1024 * 1024;
const HIGH_WATER_BYTES = 64 * 1024 * 1024;
const LOW_WATER_BYTES = 48 * 1024 * 1024;
const LEASE_TTL_MS = 5 * 60 * 1000;
const TEMP_PROMOTION_AGE_MS = 60 * 1000;
const SAFE_NAME = /^\.?[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export type QueueArtifactKind = "event" | "sidecar" | "snapshot";

export type ValidatedQueueArtifact =
  | {
      kind: "event" | "sidecar";
      path: string;
      size: number;
      value: Record<string, unknown>;
    }
  | {
      kind: "snapshot";
      path: string;
      size: number;
      bytes: Buffer;
    };

export class QueueArtifactRejected extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`Queue artifact rejected: ${reason}`);
    this.name = "QueueArtifactRejected";
    this.reason = reason;
  }
}

export interface CleanupSummary {
  scanned: number;
  deleted: number;
  retained: number;
  errors: number;
  queue_bytes: number;
  queue_files: number;
  aggregate_complete: boolean;
  budget_exhausted: boolean;
  capture_mode: "full" | "degraded";
  quota_state: "normal" | "high_water";
  observation: string;
}

export interface WorkerSummary {
  status: "busy" | "completed" | "failed";
  owner_token: string | null;
  processed: number;
  rejected: number;
  failed: number;
  recovered: number;
  promoted: number;
  migrated: number;
}

interface LeaseRecord {
  owner_token: string;
  pid: number;
  heartbeat: string;
  heartbeat_ms: number;
}

interface LeaseAcquisition {
  acquired: boolean;
  ownerToken: string;
  reclaimedOwners: Set<string>;
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

function reject(reason: string): never {
  throw new QueueArtifactRejected(reason);
}

function sameIdentity(first: Stats, second: Stats): boolean {
  return first.dev === second.dev
    && first.ino === second.ino
    && first.size === second.size
    && first.mtimeMs === second.mtimeMs
    && first.ctimeMs === second.ctimeMs;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function hasOnlyFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const allowed = new Set(fields);
  return Object.keys(value).every((field) => allowed.has(field));
}

function isBoundedString(value: unknown, maximum = 4096): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function isRepositoryPath(value: unknown): value is string {
  if (!isBoundedString(value) || isAbsolute(value) || value.includes("\\")) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function validateJsonBudget(
  value: unknown,
  budget = { fields: 0 },
  depth = 0,
): void {
  if (depth > 8) reject("schema-depth");
  if (typeof value === "string" && value.length > 64 * 1024) reject("schema-string-limit");
  if (Array.isArray(value)) {
    if (value.length > 2048) reject("schema-array-limit");
    for (const item of value) validateJsonBudget(item, budget, depth + 1);
    return;
  }
  if (!isPlainObject(value)) return;
  const entries = Object.entries(value);
  budget.fields += entries.length;
  if (entries.length > 64 || budget.fields > 16_384) reject("schema-field-limit");
  for (const [, item] of entries) validateJsonBudget(item, budget, depth + 1);
}

function validateQueueRelativePath(value: unknown): value is string {
  return isRepositoryPath(value) && value.split("/").every((segment) => SAFE_NAME.test(segment));
}

async function validateProjectBinding(value: unknown, canonicalProjectRoot: string): Promise<void> {
  if (!isBoundedString(value) || !isAbsolute(value)) reject("project-binding");
  try {
    if (await realpath(value) !== canonicalProjectRoot) reject("project-binding");
  } catch {
    reject("project-binding");
  }
}

async function validateEvent(
  value: Record<string, unknown>,
  canonicalProjectRoot: string,
): Promise<void> {
  const allowedFields = [
    "schema_version",
    "event_id",
    "correlation_id",
    "project_root",
    "timestamp",
    "tool",
    "file_path",
    "operation",
    "reason",
    "evidence_quality",
    "degradation_reason",
    "snapshots",
    "before_snapshot_path",
    "after_snapshot_path",
    "pre_snapshot_path",
    "post_snapshot_path",
    "sidecar_path",
    "ecl_context",
    "five_questions",
    "file_level",
  ] as const;
  if (!hasOnlyFields(value, allowedFields)) reject("event-fields");
  if (value.schema_version !== undefined
    && (!Number.isInteger(value.schema_version) || value.schema_version !== 1)) {
    reject("event-schema-version");
  }
  if (!isBoundedString(value.event_id, 128) || !SAFE_ID.test(value.event_id)) reject("event-id");
  if (value.correlation_id !== undefined
    && (!isBoundedString(value.correlation_id, 128) || !SAFE_ID.test(value.correlation_id))) {
    reject("correlation-id");
  }
  await validateProjectBinding(value.project_root, canonicalProjectRoot);
  if (!isBoundedString(value.timestamp, 64) || !Number.isFinite(Date.parse(value.timestamp))) {
    reject("event-timestamp");
  }
  if (!isBoundedString(value.tool, 64)
    || !isRepositoryPath(value.file_path)
    || !isBoundedString(value.reason, 16 * 1024)) {
    reject("event-fields");
  }
  if (!isBoundedString(value.operation, 32)
    || !["add", "modify", "delete", "rename"].includes(value.operation)) {
    reject("event-operation");
  }
  if (value.evidence_quality !== "full" && value.evidence_quality !== "degraded") {
    reject("evidence-quality");
  }
  if (value.evidence_quality === "degraded"
    && !isBoundedString(value.degradation_reason, 256)) {
    reject("degradation-reason");
  }
  if (value.file_level !== undefined && typeof value.file_level !== "boolean") {
    reject("event-file-level");
  }

  for (const field of [
    "before_snapshot_path",
    "after_snapshot_path",
    "pre_snapshot_path",
    "post_snapshot_path",
    "sidecar_path",
  ]) {
    const path = value[field];
    if (path !== undefined && path !== null && !validateQueueRelativePath(path)) {
      reject("artifact-reference");
    }
  }

  if (value.snapshots !== undefined) {
    if (!isPlainObject(value.snapshots)
      || !hasOnlyFields(value.snapshots, ["before", "after"])) {
      reject("snapshot-fields");
    }
    for (const snapshot of Object.values(value.snapshots)) {
      if (snapshot === null) continue;
      if (!isPlainObject(snapshot)
        || !hasOnlyFields(snapshot, ["state", "token", "size", "digest"])
        || !isBoundedString(snapshot.state, 32)
        || !["present", "missing", "degraded"].includes(snapshot.state)) {
        reject("snapshot-fields");
      }
      if (snapshot.token !== undefined
        && (!isBoundedString(snapshot.token, 200) || !SAFE_NAME.test(snapshot.token))) {
        reject("snapshot-token");
      }
      if (snapshot.size !== undefined
        && (!Number.isInteger(snapshot.size) || (snapshot.size as number) < 0)) {
        reject("snapshot-size");
      }
      if (snapshot.digest !== undefined && !/^sha256:[a-f0-9]{64}$/.test(String(snapshot.digest))) {
        reject("snapshot-digest");
      }
    }
  }
}

function validateSession(value: unknown): void {
  if (!isPlainObject(value)
    || !hasOnlyFields(value, [
      "id",
      "timestamp",
      "trigger",
      "summary",
      "total_changes",
      "files_changed",
      "changes",
    ])) {
    reject("session-fields");
  }
  if (!isBoundedString(value.id, 128) || !SAFE_ID.test(value.id)
    || !isBoundedString(value.timestamp, 64) || !Number.isFinite(Date.parse(value.timestamp))
    || !isBoundedString(value.trigger, 64)
    || !isBoundedString(value.summary, 16 * 1024)
    || !Number.isInteger(value.total_changes) || (value.total_changes as number) < 0
    || !Array.isArray(value.files_changed) || value.files_changed.length > 512
    || !value.files_changed.every(isRepositoryPath)
    || !Array.isArray(value.changes) || value.changes.length > 2048
    || value.total_changes !== value.changes.length) {
    reject("session-schema");
  }
  for (const change of value.changes) {
    if (!isPlainObject(change)
      || !hasOnlyFields(change, [
        "id",
        "timestamp",
        "file_path",
        "function_hash",
        "function_name",
        "class_name",
        "change_type",
        "reason",
        "reason_source",
        "old_content",
        "new_content",
        "start_line",
        "end_line",
        "test_status",
        "test_file",
        "error_id",
        "session_id",
        "ecl_context",
        "event_id",
        "correlation_id",
        "operation",
        "evidence_quality",
        "degradation_reason",
        "file_level",
        "synthetic",
      ])) {
      reject("change-fields");
    }
    if (!isBoundedString(change.id, 128) || !SAFE_ID.test(change.id)
      || !isBoundedString(change.timestamp, 64) || !Number.isFinite(Date.parse(change.timestamp))
      || !isRepositoryPath(change.file_path)
      || !isBoundedString(change.function_hash, 256)
      || !isBoundedString(change.function_name, 4096)
      || !(change.class_name === null || isBoundedString(change.class_name, 4096))
      || !["add", "modify", "delete", "rename"].includes(String(change.change_type))
      || !isBoundedString(change.reason, 16 * 1024)
      || !["context", "llm-inferred", "user-provided"].includes(String(change.reason_source))
      || !(change.old_content === null || typeof change.old_content === "string")
      || !(change.new_content === null || typeof change.new_content === "string")
      || !Number.isInteger(change.start_line) || (change.start_line as number) < 0
      || !Number.isInteger(change.end_line) || (change.end_line as number) < 0
      || !["pending", "pass", "fail", "skipped"].includes(String(change.test_status))
      || !(change.test_file === null || isRepositoryPath(change.test_file))
      || !(change.error_id === null || isBoundedString(change.error_id, 128))
      || change.session_id !== value.id) {
      reject("change-schema");
    }
    for (const idField of ["event_id", "correlation_id"] as const) {
      if (change[idField] !== undefined
        && (!isBoundedString(change[idField], 128) || !SAFE_ID.test(change[idField]))) {
        reject("change-id");
      }
    }
    if (change.operation !== undefined
      && !["add", "modify", "delete"].includes(String(change.operation))) {
      reject("change-operation");
    }
    if (change.evidence_quality !== undefined
      && change.evidence_quality !== "full" && change.evidence_quality !== "degraded") {
      reject("change-evidence");
    }
    if (change.file_level !== undefined && typeof change.file_level !== "boolean"
      || change.synthetic !== undefined && typeof change.synthetic !== "boolean") {
      reject("change-flags");
    }
  }
}

async function validateSidecar(
  value: Record<string, unknown>,
  canonicalProjectRoot: string,
): Promise<void> {
  if (!hasOnlyFields(value, [
    "schema_version",
    "event_id",
    "project_root",
    "content_digest",
    "session",
  ])) {
    reject("sidecar-fields");
  }
  if (value.schema_version !== undefined
    && (!Number.isInteger(value.schema_version) || value.schema_version !== 1)) {
    reject("sidecar-schema-version");
  }
  if (!isBoundedString(value.event_id, 128) || !SAFE_ID.test(value.event_id)) {
    reject("sidecar-event-id");
  }
  await validateProjectBinding(value.project_root, canonicalProjectRoot);
  if (!isBoundedString(value.content_digest, 71)
    || !/^(?:sha256:)?[a-f0-9]{64}$/.test(value.content_digest)) {
    reject("sidecar-digest");
  }
  validateSession(value.session);
}

function artifactIdFromName(name: string, kind: "event" | "sidecar"): string | null {
  let id = name;
  if (kind === "sidecar" && id.endsWith(".session.json")) id = id.slice(0, -13);
  else if (id.endsWith(".json")) id = id.slice(0, -5);
  if (id.startsWith(".tmp-")) id = id.slice(5);
  return SAFE_ID.test(id) ? id : null;
}

async function queueRoots(queueRoot: string): Promise<{
  lexical: string;
  canonical: string;
  project: string;
}> {
  const lexical = resolve(queueRoot);
  const lexicalStorageRoot = dirname(lexical);
  const lexicalProjectRoot = dirname(lexicalStorageRoot);
  try {
    const [rootMetadata, storageMetadata, canonical, project] = await Promise.all([
      lstat(lexical),
      lstat(lexicalStorageRoot),
      realpath(lexical),
      realpath(lexicalProjectRoot),
    ]);
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()
      || !storageMetadata.isDirectory() || storageMetadata.isSymbolicLink()
      || !isWithin(project, canonical)
      || relative(project, canonical).split(sep).join("/") !== ".devcompanion/queue") {
      reject("queue-root");
    }
    return { lexical, canonical, project };
  } catch (error) {
    if (error instanceof QueueArtifactRejected) throw error;
    reject("queue-root");
  }
}

export async function readValidatedQueueArtifact(
  queueRoot: string,
  artifactPath: string,
  kind: QueueArtifactKind,
): Promise<ValidatedQueueArtifact> {
  try {
    if (kind !== "event" && kind !== "sidecar" && kind !== "snapshot") {
      reject("artifact-kind");
    }
    const roots = await queueRoots(queueRoot);
    const candidate = isAbsolute(artifactPath)
      ? resolve(artifactPath)
      : resolve(roots.lexical, artifactPath);
    if (!isWithin(roots.lexical, candidate)) reject("artifact-containment");
    const logicalSegments = relative(roots.lexical, candidate).split(sep);
    if (logicalSegments.length === 0
      || logicalSegments.some((segment) => !SAFE_NAME.test(segment))) {
      reject("artifact-name");
    }

    const initial = await lstat(candidate);
    if (!initial.isFile() || initial.isSymbolicLink()) reject("artifact-type");
    const canonicalPath = await realpath(candidate);
    if (!isWithin(roots.canonical, canonicalPath)) reject("artifact-containment");

    const noFollow = process.platform === "win32" ? 0 : (constants.O_NOFOLLOW ?? 0);
    const handle = await open(candidate, constants.O_RDONLY | noFollow);
    let bytes: Buffer;
    try {
      const opened = await handle.stat();
      const maximum = kind === "snapshot" ? SNAPSHOT_READ_LIMIT : EVENT_READ_LIMIT;
      if (!opened.isFile() || !sameIdentity(initial, opened)) reject("artifact-identity");
      if (opened.size > maximum) reject("artifact-too-large");

      bytes = Buffer.alloc(opened.size);
      let offset = 0;
      while (offset < bytes.length) {
        const result = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (result.bytesRead === 0) break;
        offset += result.bytesRead;
      }

      const [afterRead, finalPath, finalMetadata] = await Promise.all([
        handle.stat(),
        realpath(candidate),
        lstat(candidate),
      ]);
      if (offset !== opened.size
        || !sameIdentity(opened, afterRead)
        || !sameIdentity(initial, finalMetadata)
        || !isWithin(roots.canonical, finalPath)) {
        reject("artifact-identity");
      }
    } finally {
      await handle.close().catch(() => undefined);
    }

    const path = relative(roots.canonical, canonicalPath).split(sep).join("/");
    if (kind === "snapshot") return { kind, path, size: bytes.length, bytes };

    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      reject("invalid-json");
    }
    if (!isPlainObject(value)) reject("json-object");
    validateJsonBudget(value);
    if (kind === "event") await validateEvent(value, roots.project);
    else await validateSidecar(value, roots.project);
    if (value.event_id !== artifactIdFromName(basename(candidate), kind)) {
      reject("artifact-id-binding");
    }
    return { kind, path, size: bytes.length, value };
  } catch (error) {
    if (error instanceof QueueArtifactRejected) throw error;
    reject("artifact-io");
  }
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function ensureQueueLayout(projectRoot: string): Promise<{ projectRoot: string; queueRoot: string }> {
  const canonicalProjectRoot = await realpath(resolve(projectRoot));
  const storageRoot = join(canonicalProjectRoot, ".devcompanion");
  await mkdir(storageRoot, { recursive: true });
  const storageMetadata = await lstat(storageRoot);
  if (!storageMetadata.isDirectory() || storageMetadata.isSymbolicLink()
    || !isWithin(canonicalProjectRoot, await realpath(storageRoot))) {
    throw new Error("queue storage root is redirected");
  }

  const queueRoot = join(storageRoot, "queue");
  await mkdir(queueRoot, { recursive: true });
  const queueMetadata = await lstat(queueRoot);
  if (!queueMetadata.isDirectory() || queueMetadata.isSymbolicLink()
    || !isWithin(canonicalProjectRoot, await realpath(queueRoot))) {
    throw new Error("queue root is redirected");
  }
  await Promise.all(["inbox", "working", "rejected", "snapshots", "sidecars"].map((directory) =>
    mkdir(join(queueRoot, directory), { recursive: true })
  ));
  return { projectRoot: canonicalProjectRoot, queueRoot: await realpath(queueRoot) };
}

async function readLeaseRecord(leaseRoot: string): Promise<LeaseRecord | null> {
  try {
    const value = JSON.parse(
      await readFile(join(leaseRoot, "owner.json"), "utf8"),
    ) as Partial<LeaseRecord>;
    return typeof value.owner_token === "string"
      && SAFE_ID.test(value.owner_token)
      && typeof value.pid === "number"
      && typeof value.heartbeat === "string"
      ? {
          owner_token: value.owner_token,
          pid: value.pid,
          heartbeat: value.heartbeat,
          heartbeat_ms: typeof value.heartbeat_ms === "number"
            ? value.heartbeat_ms
            : Date.parse(value.heartbeat),
        }
      : null;
  } catch {
    return null;
  }
}

async function leaseAge(leaseRoot: string, record: LeaseRecord | null): Promise<number> {
  const heartbeat = record && Number.isFinite(record.heartbeat_ms)
    ? record.heartbeat_ms
    : record ? Date.parse(record.heartbeat) : NaN;
  if (Number.isFinite(heartbeat)) return Date.now() - heartbeat;
  try {
    return Date.now() - (await stat(leaseRoot)).mtimeMs;
  } catch {
    return 0;
  }
}

async function staleLeaseOwners(queueRoot: string): Promise<Set<string>> {
  const owners = new Set<string>();
  for (const name of await readdir(queueRoot)) {
    if (!name.startsWith(".worker-lease.stale-")) continue;
    const staleRoot = join(queueRoot, name);
    const record = await readLeaseRecord(staleRoot);
    if (record) owners.add(record.owner_token);
    await rm(staleRoot, { recursive: true, force: true });
  }
  return owners;
}

async function acquireLease(queueRoot: string): Promise<LeaseAcquisition> {
  const leaseRoot = join(queueRoot, "worker-lease");
  const ownerToken = randomUUID();

  while (true) {
    try {
      await mkdir(leaseRoot);
      const record: LeaseRecord = {
        owner_token: ownerToken,
        pid: process.pid,
        heartbeat: new Date().toISOString(),
        heartbeat_ms: Date.now(),
      };
      try {
        await writeFile(join(leaseRoot, "owner.json"), JSON.stringify(record), { flag: "wx" });
      } catch (error) {
        await rm(leaseRoot, { recursive: true, force: true });
        throw error;
      }
      return {
        acquired: true,
        ownerToken,
        reclaimedOwners: await staleLeaseOwners(queueRoot),
      };
    } catch (error) {
      if (!isCode(error, "EEXIST")) throw error;
    }

    const observed = await readLeaseRecord(leaseRoot);
    if (await leaseAge(leaseRoot, observed) <= LEASE_TTL_MS) {
      return { acquired: false, ownerToken, reclaimedOwners: new Set() };
    }

    const current = await readLeaseRecord(leaseRoot);
    if (observed?.owner_token !== current?.owner_token
      || observed?.heartbeat !== current?.heartbeat) {
      continue;
    }
    try {
      await rename(leaseRoot, join(queueRoot, `.worker-lease.stale-${randomUUID()}`));
    } catch (error) {
      if (isCode(error, "ENOENT") || isCode(error, "EACCES") || isCode(error, "EPERM")) {
        continue;
      }
      throw error;
    }
  }
}

async function assertLeaseOwner(queueRoot: string, ownerToken: string): Promise<void> {
  const current = await readLeaseRecord(join(queueRoot, "worker-lease"));
  if (current?.owner_token !== ownerToken) throw new Error("worker lease ownership lost");
}

async function heartbeatLease(queueRoot: string, ownerToken: string): Promise<void> {
  await assertLeaseOwner(queueRoot, ownerToken);
  const leaseRoot = join(queueRoot, "worker-lease");
  const ownerPath = join(leaseRoot, "owner.json");
  const temporary = join(leaseRoot, `.owner-${ownerToken}.tmp`);
  const record: LeaseRecord = {
    owner_token: ownerToken,
    pid: process.pid,
    heartbeat: new Date().toISOString(),
    heartbeat_ms: Date.now(),
  };
  try {
    await writeFile(temporary, JSON.stringify(record), { flag: "wx" });
    await assertLeaseOwner(queueRoot, ownerToken);
    await rename(temporary, ownerPath);
    await assertLeaseOwner(queueRoot, ownerToken);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function releaseLease(queueRoot: string, ownerToken: string): Promise<void> {
  const leaseRoot = join(queueRoot, "worker-lease");
  if ((await readLeaseRecord(leaseRoot))?.owner_token !== ownerToken) return;
  const releaseRoot = join(queueRoot, `.worker-lease.release-${ownerToken}`);
  try {
    await rename(leaseRoot, releaseRoot);
    if ((await readLeaseRecord(releaseRoot))?.owner_token !== ownerToken) {
      await rename(releaseRoot, leaseRoot).catch(() => undefined);
      return;
    }
    await rm(releaseRoot, { recursive: true, force: true });
  } catch {
    // A stale-owner takeover may have won between the token check and rename.
  }
}

async function writeHealth(
  queueRoot: string,
  state: "started" | "progress" | "final",
  summary: WorkerSummary,
): Promise<void> {
  await writeFile(join(queueRoot, "worker-health.json"), `${JSON.stringify({
    state,
    ...summary,
    pid: process.pid,
    timestamp: new Date().toISOString(),
  })}\n`);
}

async function quarantine(queueRoot: string, path: string): Promise<void> {
  const rejectedRoot = join(queueRoot, "rejected");
  await mkdir(rejectedRoot, { recursive: true });
  let destination = join(rejectedRoot, basename(path));
  try {
    await lstat(destination);
    destination = join(rejectedRoot, `${basename(path)}.${randomUUID()}.rejected`);
  } catch (error) {
    if (!isCode(error, "ENOENT")) throw error;
  }
  await rename(path, destination);
}

async function promoteAgedTemps(queueRoot: string): Promise<number> {
  const inbox = join(queueRoot, "inbox");
  let promoted = 0;
  for (const entry of await readdir(inbox, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith(".tmp-") || !entry.name.endsWith(".json")) {
      continue;
    }
    const source = join(inbox, entry.name);
    if (Date.now() - (await lstat(source)).mtimeMs < TEMP_PROMOTION_AGE_MS) continue;
    try {
      await readValidatedQueueArtifact(queueRoot, source, "event");
      const destination = join(inbox, entry.name.slice(5));
      try {
        await lstat(destination);
        await quarantine(queueRoot, source);
        continue;
      } catch (error) {
        if (!isCode(error, "ENOENT")) throw error;
      }
      await rename(source, destination);
      promoted += 1;
    } catch (error) {
      if (error instanceof QueueArtifactRejected) await quarantine(queueRoot, source);
      else throw error;
    }
  }
  return promoted;
}

function legacyEvent(
  projectRoot: string,
  line: string,
  lineNumber: number,
): Record<string, unknown> | null {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  const rawPath = typeof value.file_path === "string" ? value.file_path : "";
  const filePath = isAbsolute(rawPath)
    ? relative(projectRoot, resolve(rawPath)).split(sep).join("/")
    : rawPath.replace(/\\/g, "/");
  if (!isRepositoryPath(filePath)) return null;
  const eventId = `legacy-${createHash("sha256")
    .update(`${lineNumber}\0${line}`)
    .digest("hex")
    .slice(0, 24)}`;
  return {
    schema_version: 1,
    event_id: eventId,
    correlation_id: eventId,
    project_root: projectRoot,
    timestamp: typeof value.timestamp === "string" && Number.isFinite(Date.parse(value.timestamp))
      ? value.timestamp
      : new Date().toISOString(),
    tool: typeof value.tool === "string" && value.tool ? value.tool.slice(0, 64) : "legacy",
    file_path: filePath,
    operation: "modify",
    reason: typeof value.reason === "string" && value.reason
      ? value.reason.slice(0, 16 * 1024)
      : "migrated legacy event",
    evidence_quality: "degraded",
    degradation_reason: "legacy-event",
    snapshots: { before: null, after: null },
  };
}

async function writeImmutableEvent(
  queueRoot: string,
  event: Record<string, unknown>,
): Promise<boolean> {
  const eventId = String(event.event_id);
  const inbox = join(queueRoot, "inbox");
  const destination = join(inbox, `${eventId}.json`);
  try {
    await lstat(destination);
    return false;
  } catch (error) {
    if (!isCode(error, "ENOENT")) throw error;
  }
  const temporary = join(inbox, `.tmp-${eventId}.json`);
  await writeFile(temporary, `${JSON.stringify(event)}\n`, { flag: "wx" });
  try {
    await rename(temporary, destination);
    return true;
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    if (isCode(error, "EEXIST") || isCode(error, "EPERM")) return false;
    throw error;
  }
}

async function migrateLegacyQueue(projectRoot: string, queueRoot: string): Promise<number> {
  const legacyPath = join(queueRoot, "events.jsonl");
  try {
    if (!(await lstat(legacyPath)).isFile()) return 0;
  } catch (error) {
    if (isCode(error, "ENOENT")) return 0;
    throw error;
  }

  let migrated = 0;
  let lineNumber = 0;
  const lines = createInterface({ input: createReadStream(legacyPath), crlfDelay: Infinity });
  for await (const line of lines) {
    lineNumber += 1;
    if (!line.trim()) continue;
    const event = legacyEvent(projectRoot, line, lineNumber);
    if (event) {
      if (await writeImmutableEvent(queueRoot, event)) migrated += 1;
    } else {
      await writeFile(join(queueRoot, "rejected", `legacy-line-${lineNumber}.rejected`), line);
    }
  }
  await rename(legacyPath, `${legacyPath}.migrated`);
  return migrated;
}

async function recoverWorkingEvents(
  queueRoot: string,
  ownerToken: string,
  reclaimedOwners: Set<string>,
): Promise<number> {
  const workingRoot = join(queueRoot, "working");
  const ownerRoot = join(workingRoot, ownerToken);
  await mkdir(ownerRoot, { recursive: true });
  let recovered = 0;

  for (const entry of await readdir(workingRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === ownerToken) continue;
    const sourceRoot = join(workingRoot, entry.name);
    const stale = reclaimedOwners.has(entry.name)
      || Date.now() - (await stat(sourceRoot)).mtimeMs > LEASE_TTL_MS;
    if (!stale) continue;

    for (const event of await readdir(sourceRoot, { withFileTypes: true })) {
      if (!event.isFile() || !event.name.endsWith(".json")) continue;
      const source = join(sourceRoot, event.name);
      const destination = join(ownerRoot, event.name);
      try {
        await lstat(destination);
        await quarantine(queueRoot, source);
        continue;
      } catch (error) {
        if (!isCode(error, "ENOENT")) throw error;
      }
      await rename(source, destination);
      recovered += 1;
    }
    await rmdir(sourceRoot).catch(() => undefined);
  }
  return recovered;
}

async function claimInboxEvents(queueRoot: string, ownerToken: string): Promise<number> {
  const inbox = join(queueRoot, "inbox");
  const ownerRoot = join(queueRoot, "working", ownerToken);
  await mkdir(ownerRoot, { recursive: true });
  let claimed = 0;
  const entries = (await readdir(inbox, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && !entry.name.startsWith(".") && entry.name.endsWith(".json"))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    try {
      await rename(join(inbox, entry.name), join(ownerRoot, entry.name));
      claimed += 1;
    } catch (error) {
      if (!isCode(error, "ENOENT") && !isCode(error, "EACCES") && !isCode(error, "EPERM")) {
        throw error;
      }
    }
  }
  return claimed;
}

async function processClaimedEvent(
  eventPath: string,
  projectRoot: string,
  store: HistoryStore,
): Promise<void> {
  const processor = await import("./processor.js") as Record<string, unknown>;
  const processSpoolEvent = processor.processSpoolEvent;
  if (typeof processSpoolEvent !== "function") throw new Error("processSpoolEvent is unavailable");
  await (processSpoolEvent as (
    path: string,
    root: string,
    historyStore: HistoryStore,
  ) => Promise<unknown>)(eventPath, projectRoot, store);
}

export async function runQueueWorker(projectRoot: string): Promise<WorkerSummary> {
  const roots = await ensureQueueLayout(projectRoot);
  const lease = await acquireLease(roots.queueRoot);
  const summary: WorkerSummary = {
    status: lease.acquired ? "completed" : "busy",
    owner_token: lease.acquired ? lease.ownerToken : null,
    processed: 0,
    rejected: 0,
    failed: 0,
    recovered: 0,
    promoted: 0,
    migrated: 0,
  };
  if (!lease.acquired) return summary;

  const ownerRoot = join(roots.queueRoot, "working", lease.ownerToken);
  try {
    await writeHealth(roots.queueRoot, "started", summary);
    summary.migrated = await migrateLegacyQueue(roots.projectRoot, roots.queueRoot);
    summary.promoted = await promoteAgedTemps(roots.queueRoot);
    summary.recovered = await recoverWorkingEvents(
      roots.queueRoot,
      lease.ownerToken,
      lease.reclaimedOwners,
    );
    await claimInboxEvents(roots.queueRoot, lease.ownerToken);

    const store = new HistoryStore(roots.projectRoot);
    await store.init();
    for (const entry of (await readdir(ownerRoot, { withFileTypes: true }))
      .filter((item) => item.isFile() && item.name.endsWith(".json"))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const eventPath = join(ownerRoot, entry.name);
      await heartbeatLease(roots.queueRoot, lease.ownerToken);
      try {
        await assertLeaseOwner(roots.queueRoot, lease.ownerToken);
        await processClaimedEvent(eventPath, roots.projectRoot, store);
        await assertLeaseOwner(roots.queueRoot, lease.ownerToken);
        summary.processed += 1;
      } catch (error) {
        if (error instanceof QueueArtifactRejected) {
          await assertLeaseOwner(roots.queueRoot, lease.ownerToken);
          await quarantine(roots.queueRoot, eventPath);
          summary.rejected += 1;
        } else {
          summary.failed += 1;
        }
      }
      await writeHealth(roots.queueRoot, "progress", summary);
    }
    summary.status = summary.failed > 0 ? "failed" : "completed";
    await writeHealth(roots.queueRoot, "final", summary);
    return summary;
  } catch (error) {
    summary.status = "failed";
    summary.failed += 1;
    await writeHealth(roots.queueRoot, "final", summary).catch(() => undefined);
    throw error;
  } finally {
    await rmdir(ownerRoot).catch(() => undefined);
    await releaseLease(roots.queueRoot, lease.ownerToken);
  }
}

async function* walkFiles(root: string): AsyncGenerator<string> {
  let directory;
  try {
    directory = await opendir(root);
  } catch {
    return;
  }

  for await (const entry of directory) {
    const path = join(root, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) yield* walkFiles(path);
    else yield path;
  }
}

function addReference(queueRoot: string, references: Set<string>, value: string): void {
  const candidate = isAbsolute(value) ? resolve(value) : resolve(queueRoot, value);
  if (isWithin(queueRoot, candidate)) references.add(candidate);
}

function collectEventReferences(
  queueRoot: string,
  references: Set<string>,
  event: Record<string, unknown>,
): void {
  for (const field of [
    "before_snapshot_path",
    "after_snapshot_path",
    "pre_snapshot_path",
    "post_snapshot_path",
    "sidecar_path",
  ]) {
    const value = event[field];
    if (typeof value === "string") addReference(queueRoot, references, value);
  }

  const snapshots = event.snapshots;
  if (!snapshots || typeof snapshots !== "object") return;
  for (const value of Object.values(snapshots as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const token = (value as Record<string, unknown>).token;
    if (typeof token === "string") {
      addReference(queueRoot, references, join("snapshots", token));
    }
  }
}

async function activeReferences(queueRoot: string): Promise<Set<string>> {
  const references = new Set<string>();
  for (const directory of ["inbox", "working"]) {
    let scanned = 0;
    for await (const path of walkFiles(join(queueRoot, directory))) {
      if (scanned >= SCAN_FILE_BUDGET) break;
      scanned += 1;
      try {
        const metadata = await lstat(path);
        if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > EVENT_READ_LIMIT) {
          continue;
        }
        const canonicalPath = await realpath(path);
        if (!isWithin(queueRoot, canonicalPath)) continue;
        references.add(canonicalPath);
        collectEventReferences(
          queueRoot,
          references,
          JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>,
        );
      } catch {
        // Malformed or racing events remain untouched for worker quarantine/retry.
      }
    }
  }
  return references;
}

function isCleanupCandidate(queueRoot: string, path: string): boolean {
  const logicalPath = relative(queueRoot, path).split(sep).join("/");
  const topDirectory = logicalPath.split("/")[0];
  return topDirectory === "sidecars"
    || topDirectory === "snapshots"
    || topDirectory === "rejected"
    || basename(path).startsWith(".tmp-");
}

async function writeQuotaObservation(
  queueRoot: string,
  summary: CleanupSummary,
): Promise<void> {
  const marker = join(queueRoot, "overflow.json");
  if (summary.capture_mode === "full") {
    if (summary.queue_bytes <= LOW_WATER_BYTES) {
      try {
        await unlink(marker);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") summary.errors += 1;
      }
    }
    return;
  }

  const temporary = `${marker}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, `${JSON.stringify({
      state: "degraded",
      reason: "queue-high-water",
      queue_bytes: summary.queue_bytes,
      queue_files: summary.queue_files,
      observed_at: new Date().toISOString(),
    })}\n`, { flag: "wx" });
    await rename(temporary, marker);
  } catch {
    summary.errors += 1;
    try {
      await unlink(temporary);
    } catch {
      // Best-effort cleanup of a failed marker temp.
    }
  }
}

export async function cleanupExpiredSnapshots(
  queueRoot: string,
  now: Date,
): Promise<CleanupSummary> {
  if (!Number.isFinite(now.getTime())) throw new RangeError("now must be a valid date");

  const rootMetadata = await lstat(queueRoot);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error("queue root must be a real directory");
  }
  const canonicalQueueRoot = await realpath(queueRoot);
  const references = await activeReferences(canonicalQueueRoot);
  const cutoff = now.getTime() - RETENTION_MS;
  const deadline = Date.now() + SCAN_TIME_BUDGET_MS;
  const summary: CleanupSummary = {
    scanned: 0,
    deleted: 0,
    retained: 0,
    errors: 0,
    queue_bytes: 0,
    queue_files: 0,
    aggregate_complete: true,
    budget_exhausted: false,
    capture_mode: "full",
    quota_state: "normal",
    observation: "normal",
  };

  for await (const path of walkFiles(canonicalQueueRoot)) {
    if (summary.scanned >= SCAN_FILE_BUDGET || Date.now() >= deadline) {
      summary.budget_exhausted = true;
      summary.aggregate_complete = false;
      break;
    }
    summary.scanned += 1;

    try {
      const metadata = await lstat(path);
      summary.queue_files += 1;
      summary.queue_bytes += metadata.size;
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        summary.retained += 1;
        continue;
      }

      const canonicalPath = await realpath(path);
      if (!isWithin(canonicalQueueRoot, canonicalPath)
        || references.has(canonicalPath)
        || !isCleanupCandidate(canonicalQueueRoot, canonicalPath)
        || metadata.mtimeMs > cutoff) {
        summary.retained += 1;
        continue;
      }

      const finalMetadata = await lstat(path);
      const finalPath = await realpath(path);
      if (!finalMetadata.isFile()
        || finalMetadata.isSymbolicLink()
        || finalMetadata.dev !== metadata.dev
        || finalMetadata.ino !== metadata.ino
        || !isWithin(canonicalQueueRoot, finalPath)) {
        summary.retained += 1;
        continue;
      }

      await unlink(path);
      summary.deleted += 1;
    } catch {
      summary.errors += 1;
    }
  }

  if (summary.queue_bytes >= HIGH_WATER_BYTES) {
    summary.capture_mode = "degraded";
    summary.quota_state = "high_water";
    summary.observation = "queue high_water overflow: capture degraded";
  }
  await writeQuotaObservation(canonicalQueueRoot, summary);
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runQueueWorker(process.argv[2] ?? process.cwd())
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary)}\n`);
    })
    .catch((error: unknown) => {
      const name = error instanceof Error ? error.name : "WorkerError";
      process.stderr.write(`[aidev-daemon] queue worker failed: ${name}\n`);
      process.exitCode = 1;
    });
}
