import { execFile } from "node:child_process";
import {
  link,
  lstat,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve, extname, join, isAbsolute, relative, sep } from "node:path";
import { promisify } from "node:util";
import { getGitDiff, parseUnifiedDiff, annotateChanges, toChangeRecords } from "@aidev/core";
import type { FileDiff } from "@aidev/core";
import { parseFileAuto, getSupportedExtensions } from "@aidev/ast";
import { HistoryStore } from "@aidev/history";
import type { ChangeRecord, ReviewSession, EclContext } from "@aidev/history";
import type { FunctionSignature } from "@aidev/ast";
import { createHash, randomUUID } from "node:crypto";
import { QueueArtifactRejected, readValidatedQueueArtifact } from "./worker.js";

const execFileAsync = promisify(execFile);
const EVENT_ARTIFACT_LIMIT = 256 * 1024;
const SAFE_EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SAFE_SNAPSHOT_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

interface SnapshotDescriptor {
  state: "present" | "missing" | "degraded";
  token?: string;
}

export interface SnapshotQueueEvent {
  event_id: string;
  project_root: string;
  file_path: string;
  operation: "add" | "modify" | "delete";
  evidence_quality: "full" | "degraded";
  snapshots?: {
    before?: SnapshotDescriptor | null;
    after?: SnapshotDescriptor | null;
  };
}

export class SnapshotMissing extends Error {
  constructor() {
    super("Snapshot evidence is missing");
    this.name = "SnapshotMissing";
  }
}

function safeRepositoryPath(path: string): boolean {
  return path.length > 0
    && path.length <= 4096
    && !isAbsolute(path)
    && !path.includes("\\")
    && !path.includes("\0")
    && !path.includes("\r")
    && !path.includes("\n")
    && path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function snapshotToken(event: SnapshotQueueEvent, side: "before" | "after"): string {
  const descriptor = event.snapshots?.[side];
  if (descriptor && descriptor.state !== "present") throw new SnapshotMissing();
  const token = descriptor?.token ?? `${event.event_id}.${side}`;
  if (!SAFE_SNAPSHOT_TOKEN.test(token)) throw new SnapshotMissing();
  return token;
}

async function validatedSnapshot(
  event: SnapshotQueueEvent,
  side: "before" | "after",
): Promise<Buffer> {
  const queueRoot = join(resolve(event.project_root), ".devcompanion", "queue");
  const artifactPath = join(queueRoot, "snapshots", snapshotToken(event, side));
  const artifact = await readValidatedQueueArtifact(queueRoot, artifactPath, "snapshot");
  if (artifact.kind !== "snapshot") throw new SnapshotMissing();
  return artifact.bytes;
}

async function snapshotDiffOutput(before: string, after: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--no-index", "--no-ext-diff", "--unified=3", "--", before, after],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024, shell: false },
    );
    return stdout;
  } catch (error) {
    const failure = error as Error & { code?: number | string; stdout?: string | Buffer };
    if (failure.code === 1 || failure.code === "1") return String(failure.stdout ?? "");
    throw error;
  }
}

function rewriteSnapshotHeaders(
  output: string,
  filePath: string,
  operation: SnapshotQueueEvent["operation"],
): string {
  const lines = output ? output.split("\n") : [
    `diff --git a/${filePath} b/${filePath}`,
    "index e69de29..e69de29 100644",
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
  ];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].startsWith("diff --git ")) {
      lines[index] = `diff --git a/${filePath} b/${filePath}`;
    } else if (lines[index].startsWith("--- ")) {
      lines[index] = operation === "add" ? "--- /dev/null" : `--- a/${filePath}`;
    } else if (lines[index].startsWith("+++ ")) {
      lines[index] = operation === "delete" ? "+++ /dev/null" : `+++ b/${filePath}`;
    }
  }
  if (operation !== "modify" && !lines.some((line) => /^(?:new|deleted) file mode /.test(line))) {
    lines.splice(1, 0, operation === "add" ? "new file mode 100644" : "deleted file mode 100644");
  }
  return lines.join("\n");
}

export async function buildSnapshotDiffs(
  events: readonly SnapshotQueueEvent[],
): Promise<FileDiff[]> {
  const diffs: FileDiff[] = [];
  for (const event of events) {
    if (event.evidence_quality !== "full") continue;
    if (!SAFE_EVENT_ID.test(event.event_id)
      || !isAbsolute(event.project_root)
      || !safeRepositoryPath(event.file_path)) {
      throw new SnapshotMissing();
    }

    const before = event.operation === "add"
      ? Buffer.alloc(0)
      : await validatedSnapshot(event, "before");
    const after = event.operation === "delete"
      ? Buffer.alloc(0)
      : await validatedSnapshot(event, "after");
    const temporaryRoot = await mkdtemp(join(tmpdir(), "aidev-snapshot-diff-"));
    try {
      const beforePath = join(temporaryRoot, "before");
      const afterPath = join(temporaryRoot, "after");
      await Promise.all([
        writeFile(beforePath, before),
        writeFile(afterPath, after),
      ]);
      const output = await snapshotDiffOutput(beforePath, afterPath);
      if (!output && event.operation === "modify") continue;
      const rewritten = rewriteSnapshotHeaders(output, event.file_path, event.operation);
      const [parsed] = parseUnifiedDiff(rewritten);
      if (!parsed) throw new Error("git produced an invalid snapshot diff");
      parsed.file_path = event.file_path;
      parsed.old_path = null;
      parsed.status = event.operation === "add"
        ? "added"
        : event.operation === "delete" ? "deleted" : "modified";
      parsed.raw_diff = rewritten;
      diffs.push(parsed);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }
  return diffs;
}

interface SpoolEvent extends SnapshotQueueEvent {
  timestamp: string;
  tool: string;
  reason: string;
  correlation_id?: string;
  degradation_reason?: ChangeRecord["degradation_reason"];
  file_level?: boolean;
  ecl_context?: EclContext;
}

interface ClaimFence {
  queueRoot: string;
  ownerToken: string;
}

interface FinalizedSidecar {
  schema_version: 1;
  event_id: string;
  project_root: string;
  content_digest: string;
  session: ReviewSession;
}

export interface EventSummary {
  event_id: string;
  session_id: string;
  changes: number;
  evidence_quality: "full" | "degraded";
  reused_sidecar: boolean;
  acked: true;
}

export class QueueLeaseLost extends Error {
  constructor() {
    super("Queue worker lease ownership lost");
    this.name = "QueueLeaseLost";
  }
}

const DEGRADATION_REASONS = new Set<NonNullable<ChangeRecord["degradation_reason"]>>([
  "ambiguous-pre-manifest",
  "binary-or-unsupported",
  "identity-changed",
  "legacy-event",
  "path-escape",
  "queue-overflow",
  "read-error",
  "repo-escape",
  "size-limit",
  "snapshot-unavailable",
  "storage-root-redirect",
  "symlink-target",
  "unsupported-extension",
  "unsupported-file-type",
]);

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

function stableHash(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}

function sessionId(eventId: string): string {
  return `session-${stableHash(eventId).slice(0, 32)}`;
}

function normalizedEclContext(value: unknown): EclContext | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new QueueArtifactRejected("event-ecl-context");
  }
  const context = value as Record<string, unknown>;
  if (Object.keys(context).some((field) =>
    !["feature", "requirements", "decisions", "ecl_file"].includes(field))) {
    throw new QueueArtifactRejected("event-ecl-context");
  }
  const stringList = (item: unknown): item is string[] => Array.isArray(item)
    && item.length <= 256
    && item.every((entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 4096);
  if (typeof context.feature !== "string" || context.feature.length === 0
    || context.feature.length > 4096
    || context.requirements !== undefined && !stringList(context.requirements)
    || context.decisions !== undefined && !stringList(context.decisions)
    || context.ecl_file !== undefined
      && (typeof context.ecl_file !== "string" || !safeRepositoryPath(context.ecl_file))) {
    throw new QueueArtifactRejected("event-ecl-context");
  }
  return context as unknown as EclContext;
}

function normalizeSpoolEvent(value: Record<string, unknown>): SpoolEvent {
  if (value.operation !== "add" && value.operation !== "modify" && value.operation !== "delete") {
    throw new QueueArtifactRejected("event-operation");
  }
  let degradationReason: ChangeRecord["degradation_reason"];
  if (value.evidence_quality === "degraded") {
    if (typeof value.degradation_reason !== "string"
      || !DEGRADATION_REASONS.has(
        value.degradation_reason as NonNullable<ChangeRecord["degradation_reason"]>,
      )) {
      throw new QueueArtifactRejected("degradation-reason");
    }
    degradationReason = value.degradation_reason as NonNullable<ChangeRecord["degradation_reason"]>;
  }
  return {
    event_id: String(value.event_id),
    correlation_id: typeof value.correlation_id === "string" ? value.correlation_id : undefined,
    project_root: String(value.project_root),
    timestamp: String(value.timestamp),
    tool: String(value.tool),
    file_path: String(value.file_path),
    operation: value.operation,
    reason: String(value.reason),
    evidence_quality: value.evidence_quality === "full" ? "full" : "degraded",
    degradation_reason: degradationReason,
    snapshots: value.snapshots as SpoolEvent["snapshots"],
    file_level: value.file_level === true,
    ecl_context: normalizedEclContext(value.ecl_context),
  };
}

async function readLeaseOwner(queueRoot: string): Promise<string> {
  const leaseRoot = join(queueRoot, "worker-lease");
  const leaseMetadata = await lstat(leaseRoot);
  if (!leaseMetadata.isDirectory() || leaseMetadata.isSymbolicLink()) throw new QueueLeaseLost();
  const ownerPath = join(leaseRoot, "owner.json");
  const initial = await lstat(ownerPath);
  if (!initial.isFile() || initial.isSymbolicLink() || initial.size > 8192) {
    throw new QueueLeaseLost();
  }

  const noFollow = process.platform === "win32" ? 0 : (constants.O_NOFOLLOW ?? 0);
  const handle = await open(ownerPath, constants.O_RDONLY | noFollow);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== initial.dev || opened.ino !== initial.ino
      || opened.size !== initial.size || opened.mtimeMs !== initial.mtimeMs) {
      throw new QueueLeaseLost();
    }
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    const final = await handle.stat();
    if (offset !== opened.size || final.dev !== opened.dev || final.ino !== opened.ino
      || final.size !== opened.size || final.mtimeMs !== opened.mtimeMs) {
      throw new QueueLeaseLost();
    }
    const value = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
    if (typeof value.owner_token !== "string" || !SAFE_EVENT_ID.test(value.owner_token)) {
      throw new QueueLeaseLost();
    }
    return value.owner_token;
  } catch (error) {
    if (error instanceof QueueLeaseLost) throw error;
    throw new QueueLeaseLost();
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function assertCurrentClaim(
  eventPath: string,
  projectRoot: string,
  expectedOwner?: string,
): Promise<ClaimFence> {
  try {
    const canonicalProject = await realpath(resolve(projectRoot));
    const queueRoot = await realpath(join(canonicalProject, ".devcompanion", "queue"));
    if (!isWithin(canonicalProject, queueRoot)) throw new QueueLeaseLost();
    const eventMetadata = await lstat(eventPath);
    if (!eventMetadata.isFile() || eventMetadata.isSymbolicLink()) throw new QueueLeaseLost();
    const canonicalEvent = await realpath(eventPath);
    if (!isWithin(queueRoot, canonicalEvent)) throw new QueueLeaseLost();
    const segments = relative(queueRoot, canonicalEvent).split(sep);
    if (segments.length !== 3 || segments[0] !== "working"
      || !SAFE_EVENT_ID.test(segments[1]) || basename(canonicalEvent) !== segments[2]) {
      throw new QueueLeaseLost();
    }
    const ownerRoot = join(queueRoot, "working", segments[1]);
    const ownerMetadata = await lstat(ownerRoot);
    if (!ownerMetadata.isDirectory() || ownerMetadata.isSymbolicLink()
      || await realpath(ownerRoot) !== resolve(canonicalEvent, "..")) {
      throw new QueueLeaseLost();
    }
    const ownerToken = await readLeaseOwner(queueRoot);
    if (ownerToken !== segments[1] || expectedOwner && ownerToken !== expectedOwner) {
      throw new QueueLeaseLost();
    }
    return { queueRoot, ownerToken };
  } catch (error) {
    if (error instanceof QueueLeaseLost) throw error;
    throw new QueueLeaseLost();
  }
}

function syntheticRecord(event: SpoolEvent, finalizedSessionId: string): ChangeRecord {
  return {
    id: `change-${stableHash(event.event_id, "file").slice(0, 32)}`,
    timestamp: event.timestamp,
    file_path: event.file_path,
    function_hash: `file-${stableHash(event.file_path).slice(0, 16)}`,
    function_name: "<file>",
    class_name: null,
    change_type: event.operation,
    reason: event.reason,
    reason_source: "context",
    old_content: null,
    new_content: null,
    start_line: 0,
    end_line: 0,
    test_status: "pending",
    test_file: null,
    error_id: null,
    session_id: finalizedSessionId,
    ecl_context: event.ecl_context,
    event_id: event.event_id,
    correlation_id: event.correlation_id,
    operation: event.operation,
    evidence_quality: event.evidence_quality,
    degradation_reason: event.degradation_reason,
    file_level: true,
    synthetic: true,
  };
}

async function snapshotFunctionMap(
  event: SpoolEvent,
  diffs: readonly FileDiff[],
): Promise<Map<string, FunctionSignature[]>> {
  const functionMap = new Map<string, FunctionSignature[]>();
  for (const diff of diffs) functionMap.set(diff.file_path, []);
  const extension = extname(event.file_path).toLowerCase();
  if (event.operation === "delete" || !new Set(getSupportedExtensions()).has(extension)) {
    return functionMap;
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), "aidev-snapshot-ast-"));
  try {
    const sourcePath = join(temporaryRoot, `source${extension}`);
    await writeFile(sourcePath, await validatedSnapshot(event, "after"));
    const parsed = await parseFileAuto(sourcePath);
    functionMap.set(event.file_path, [
      ...parsed.functions,
      ...parsed.classes.flatMap((item) => item.methods),
    ]);
  } catch {
    functionMap.set(event.file_path, []);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  return functionMap;
}

async function buildFinalizedSession(event: SpoolEvent): Promise<ReviewSession> {
  const finalizedSessionId = sessionId(event.event_id);
  let records: ChangeRecord[];
  if (event.evidence_quality === "degraded" || event.file_level) {
    records = [syntheticRecord(event, finalizedSessionId)];
  } else {
    const diffs = await buildSnapshotDiffs([event]);
    const annotations = annotateChanges(diffs, await snapshotFunctionMap(event, diffs), {
      reason: event.reason,
      reason_source: "context",
      session_id: finalizedSessionId,
      ecl_context: event.ecl_context,
    });
    records = toChangeRecords(annotations, finalizedSessionId, event.ecl_context).map((record, index) => ({
      ...record,
      id: `change-${stableHash(
        event.event_id,
        record.function_hash,
        String(index),
      ).slice(0, 32)}`,
      timestamp: event.timestamp,
      event_id: event.event_id,
      correlation_id: event.correlation_id,
      operation: event.operation,
      evidence_quality: "full",
    }));
  }

  return {
    id: finalizedSessionId,
    timestamp: event.timestamp,
    trigger: "hook",
    summary: `Auto-captured immutable event ${event.event_id}`,
    total_changes: records.length,
    files_changed: [event.file_path],
    changes: records,
  };
}

function digestSession(session: ReviewSession): string {
  return createHash("sha256").update(JSON.stringify(session)).digest("hex");
}

function validateFinalizedSidecar(
  value: Record<string, unknown>,
  event: SpoolEvent,
): ReviewSession {
  const session = value.session as ReviewSession;
  const digest = String(value.content_digest).replace(/^sha256:/, "");
  if (digest !== digestSession(session)
    || session.id !== sessionId(event.event_id)
    || session.timestamp !== event.timestamp
    || session.files_changed.length !== 1
    || session.files_changed[0] !== event.file_path
    || session.changes.some((change) => change.session_id !== session.id
      || change.event_id !== event.event_id
      || change.correlation_id !== event.correlation_id
      || change.file_path !== event.file_path
      || change.operation !== event.operation
      || change.evidence_quality !== event.evidence_quality)) {
    throw new QueueArtifactRejected("sidecar-content");
  }
  return session;
}

async function readFinalizedSidecar(
  queueRoot: string,
  path: string,
  event: SpoolEvent,
): Promise<ReviewSession> {
  const artifact = await readValidatedQueueArtifact(queueRoot, path, "sidecar");
  if (artifact.kind !== "sidecar") throw new QueueArtifactRejected("sidecar-kind");
  return validateFinalizedSidecar(artifact.value, event);
}

async function finalizeSidecar(
  eventPath: string,
  projectRoot: string,
  fence: ClaimFence,
  event: SpoolEvent,
): Promise<{ session: ReviewSession; reused: boolean; path: string }> {
  const path = join(fence.queueRoot, "sidecars", `${event.event_id}.session.json`);
  try {
    await lstat(path);
    return { session: await readFinalizedSidecar(fence.queueRoot, path, event), reused: true, path };
  } catch (error) {
    if (!isCode(error, "ENOENT")) throw error;
  }

  const session = await buildFinalizedSession(event);
  const sidecar: FinalizedSidecar = {
    schema_version: 1,
    event_id: event.event_id,
    project_root: event.project_root,
    content_digest: `sha256:${digestSession(session)}`,
    session,
  };
  const bytes = Buffer.from(`${JSON.stringify(sidecar)}\n`);
  if (bytes.length > EVENT_ARTIFACT_LIMIT) throw new QueueArtifactRejected("sidecar-too-large");

  await assertCurrentClaim(eventPath, projectRoot, fence.ownerToken);
  const temporary = join(fence.queueRoot, "sidecars", `.tmp-${event.event_id}.${randomUUID()}.json`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    await assertCurrentClaim(eventPath, projectRoot, fence.ownerToken);
    try {
      await link(temporary, path);
    } catch (error) {
      if (!isCode(error, "EEXIST")) throw error;
    }
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  return { session: await readFinalizedSidecar(fence.queueRoot, path, event), reused: false, path };
}

function snapshotEvidencePaths(event: SpoolEvent, queueRoot: string): string[] {
  if (event.evidence_quality !== "full") return [];
  const sides: Array<"before" | "after"> = [];
  if (event.operation !== "add") sides.push("before");
  if (event.operation !== "delete") sides.push("after");
  return sides.map((side) => join(queueRoot, "snapshots", snapshotToken(event, side)));
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isCode(error, "ENOENT")) throw error;
  }
}

export async function processSpoolEvent(
  eventPath: string,
  projectRoot: string,
  store: HistoryStore,
): Promise<EventSummary> {
  const fence = await assertCurrentClaim(eventPath, projectRoot);
  const artifact = await readValidatedQueueArtifact(fence.queueRoot, eventPath, "event");
  if (artifact.kind !== "event") throw new QueueArtifactRejected("event-kind");
  const event = normalizeSpoolEvent(artifact.value);
  const finalized = await finalizeSidecar(eventPath, projectRoot, fence, event);

  await assertCurrentClaim(eventPath, projectRoot, fence.ownerToken);
  await store.saveSession(finalized.session);

  await assertCurrentClaim(eventPath, projectRoot, fence.ownerToken);
  for (const path of snapshotEvidencePaths(event, fence.queueRoot)) await removeIfPresent(path);
  await removeIfPresent(finalized.path);
  await removeIfPresent(eventPath);
  return {
    event_id: event.event_id,
    session_id: finalized.session.id,
    changes: finalized.session.changes.length,
    evidence_quality: event.evidence_quality,
    reused_sidecar: finalized.reused,
    acked: true,
  };
}

interface QueueEvent {
  timestamp: string;
  tool: string;
  file_path: string;
  pre_snapshot_path: string | null;
  reason: string;
  ecl_context?: EclContext;
}

export async function processQueue(
  queueFile: string,
  projectRoot: string,
  store: HistoryStore
): Promise<void> {
  if (!existsSync(queueFile)) return;

  const processingFile = queueFile + ".processing";
  try {
    await rename(queueFile, processingFile);
  } catch {
    return;
  }

  const content = await readFile(processingFile, "utf-8");
  const events = content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as QueueEvent);

  if (events.length === 0) return;

  console.log(`[daemon] Processing ${events.length} events...`);

  const changedFiles = [...new Set(events.map((e) => e.file_path))];
  const diffs = await getGitDiff(projectRoot);
  const relevantDiffs = diffs.filter((d) =>
    changedFiles.some((f) => f.endsWith(d.file_path))
  );

  if (relevantDiffs.length === 0) {
    console.log("[daemon] No relevant diffs found, skipping.");
    await writeFile(processingFile, "");
    return;
  }

  const supportedExts = new Set(getSupportedExtensions());
  const functionMap = new Map<string, FunctionSignature[]>();
  for (const diff of relevantDiffs) {
    const ext = extname(diff.file_path).toLowerCase();
    if (supportedExts.has(ext) && diff.status !== "deleted") {
      try {
        const parsed = await parseFileAuto(resolve(projectRoot, diff.file_path));
        functionMap.set(diff.file_path, [
          ...parsed.functions,
          ...parsed.classes.flatMap((c) => c.methods),
        ]);
      } catch {
        functionMap.set(diff.file_path, []);
      }
    }
  }

  const sessionId = randomUUID();
  const reason = events[0]?.reason ?? "auto-captured";
  const eclContext = events.find((e) => e.ecl_context)?.ecl_context;
  const annotations = annotateChanges(relevantDiffs, functionMap, {
    reason,
    reason_source: "context",
    session_id: sessionId,
    ecl_context: eclContext,
  });

  const records = toChangeRecords(annotations, sessionId, eclContext);

  const session: ReviewSession = {
    id: sessionId,
    timestamp: new Date().toISOString(),
    trigger: "hook",
    summary: `Auto-captured: ${records.length} changes in ${changedFiles.length} files`,
    total_changes: records.length,
    files_changed: [...new Set(records.map((r) => r.file_path))],
    changes: records,
  };

  await store.saveSession(session);
  await writeFile(processingFile, "");
  console.log(`[daemon] Session saved: ${session.id} (${records.length} changes)`);
}
