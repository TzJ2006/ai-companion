import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { findMatchingGuards, isInactiveEclStatus } from "./feature-guard.js";
import {
  deriveCorrelationId,
  getChangedFilePaths,
  isFileWriteTool,
  type ToolUseInput,
} from "./tool-event.js";
import {
  capturePreEditSnapshots,
  readSnapshotTargetSafely,
  type SnapshotDegradationReason,
  type SnapshotManifest,
} from "./snapshot.js";

export { capturePreEditSnapshots, readSnapshotTargetSafely };
export type {
  SnapshotDegradationReason,
  SnapshotManifest,
  SnapshotReadResult,
} from "./snapshot.js";

interface EclContextSlim {
  feature: string;
  requirements?: string[];
  decisions?: string[];
  ecl_file?: string;
}

export interface HookEvent {
  schema_version?: 1;
  event_id?: string;
  correlation_id?: string;
  project_root?: string;
  timestamp: string;
  tool: string;
  file_path: string;
  operation?: "add" | "modify" | "delete";
  evidence_quality?: "full" | "degraded";
  degradation_reason?: SnapshotDegradationReason | "ambiguous-pre-manifest" | "snapshot-unavailable";
  pre_snapshot_path: string | null;
  post_snapshot_path?: string | null;
  snapshots?: {
    before: { state: "present" | "missing"; token?: string } | null;
    after: { state: "present" | "missing"; token?: string } | null;
  };
  reason: string;
  ecl_context?: EclContextSlim;
  // Placeholder for a later "5-question" payload (see project rule on
  // file-level degradation). Always present and additive; null until populated.
  five_questions: Record<string, unknown> | null;
  // true for events recorded at file level (no AST parse), i.e. any non-AST, non-binary extension.
  file_level?: boolean;
}

const QUEUE_DIR = ".devcompanion/queue";

const SUPPORTED_EXTENSIONS = new Set([".py", ".pyi", ".ts", ".tsx", ".mts", ".cts"]);

// Every non-AST extension degrades to file-level recording instead of being
// dropped ("unsupported files degrade to file-level recording, not dropped").
// Only clearly binary artifacts are excluded.
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".bmp", ".webp", ".svgz",
  ".exe", ".dll", ".so", ".dylib", ".wasm", ".node", ".pyc",
  ".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar",
  ".pdf", ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".mp3", ".mp4", ".wav", ".avi", ".mov", ".mkv", ".db", ".sqlite",
]);

function isFileLevelExtension(ext: string): boolean {
  return !SUPPORTED_EXTENSIONS.has(ext) && !BINARY_EXTENSIONS.has(ext);
}
const WORKER_LAUNCH_COOLDOWN_MS = 5_000;

type EventDegradationReason = NonNullable<HookEvent["degradation_reason"]>;

interface EventTarget {
  projectRoot: string;
  filePath: string;
  relativePath: string;
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

function validateDirectory(projectRoot: string, directory: string): boolean {
  try {
    const metadata = lstatSync(directory);
    return metadata.isDirectory()
      && !metadata.isSymbolicLink()
      && isWithin(projectRoot, realpathSync.native(directory));
  } catch {
    return false;
  }
}

function prepareQueueDirectories(
  projectRoot: string,
): { queue: string; inbox: string; snapshots: string } | null {
  const directories = [
    join(projectRoot, ".devcompanion"),
    join(projectRoot, QUEUE_DIR),
    join(projectRoot, QUEUE_DIR, "snapshots"),
    join(projectRoot, QUEUE_DIR, "inbox"),
  ];
  try {
    for (const directory of directories) {
      if (!existsSync(directory)) mkdirSync(directory, { mode: 0o700 });
      if (!validateDirectory(projectRoot, directory)) return null;
    }
    return { queue: directories[1], snapshots: directories[2], inbox: directories[3] };
  } catch {
    return null;
  }
}

function eventTargets(
  input: ToolUseInput,
  manifests: SnapshotManifest[],
  correlationId: string,
): EventTarget[] {
  const targets = new Map<string, EventTarget>();
  for (const filePath of getChangedFilePaths(input)) {
    const root = findProjectRoot(filePath);
    if (!root) continue;
    try {
      const projectRoot = realpathSync.native(root);
      const relativePath = relative(projectRoot, filePath).replace(/\\/g, "/");
      targets.set(`${projectRoot}\0${relativePath}`, { projectRoot, filePath, relativePath });
    } catch {
      continue;
    }
  }
  for (const manifest of manifests) {
    if (manifest.correlation_id !== correlationId) continue;
    const filePath = resolve(manifest.project_root, manifest.file_path);
    targets.set(`${manifest.project_root}\0${manifest.file_path}`, {
      projectRoot: manifest.project_root,
      filePath,
      relativePath: manifest.file_path,
    });
  }
  return [...targets.values()];
}

function persistedCandidates(target: EventTarget, correlationId: string): SnapshotManifest[] {
  const pathKey = createHash("sha256").update(target.relativePath).digest("hex");
  const fifoRoot = join(target.projectRoot, QUEUE_DIR, "snapshots", "manifests", pathKey);
  if (!existsSync(fifoRoot)) return [];
  const candidates: SnapshotManifest[] = [];
  for (const name of readdirSync(fifoRoot)) {
    try {
      const candidate = JSON.parse(readFileSync(join(fifoRoot, name), "utf8")) as SnapshotManifest;
      if (candidate.project_root === target.projectRoot
        && candidate.file_path === target.relativePath
        && candidate.correlation_id === correlationId
        && typeof candidate.snapshot_nonce === "string") {
        candidates.push(candidate);
      }
    } catch {
      continue;
    }
  }
  return candidates;
}

function eligibleCandidates(
  target: EventTarget,
  correlationId: string,
  manifests: SnapshotManifest[],
): SnapshotManifest[] {
  const candidates = new Map<string, SnapshotManifest>();
  for (const manifest of [...manifests, ...persistedCandidates(target, correlationId)]) {
    if (manifest.project_root === target.projectRoot
      && manifest.file_path === target.relativePath
      && manifest.correlation_id === correlationId) {
      candidates.set(manifest.snapshot_nonce, manifest);
    }
  }
  return [...candidates.values()];
}

function writeImmutableFile(filePath: string, content: string): void {
  const descriptor = openSync(filePath, "wx", 0o600);
  try {
    writeFileSync(descriptor, content, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function validPreSnapshot(manifest: SnapshotManifest): boolean {
  if (manifest.before_state === "missing") return true;
  if (manifest.before_state !== "present" || !manifest.pre_snapshot_path) return false;
  const snapshotsRoot = resolve(manifest.project_root, QUEUE_DIR, "snapshots");
  const snapshotPath = resolve(manifest.project_root, manifest.pre_snapshot_path);
  return isWithin(snapshotsRoot, snapshotPath) && existsSync(snapshotPath);
}

function operationFor(
  manifest: SnapshotManifest | undefined,
  afterState: ReturnType<typeof readSnapshotTargetSafely>["state"],
): HookEvent["operation"] {
  if (manifest?.before_state === "missing" && afterState === "present") return "add";
  if (manifest?.before_state === "present" && afterState === "missing") return "delete";
  return "modify";
}

function consumeManifests(projectRoot: string, manifests: SnapshotManifest[]): void {
  const manifestRoot = resolve(projectRoot, QUEUE_DIR, "snapshots", "manifests");
  for (const manifest of manifests) {
    if (!manifest.manifest_path) continue;
    const manifestPath = resolve(projectRoot, manifest.manifest_path);
    if (!isWithin(manifestRoot, manifestPath)) continue;
    try {
      unlinkSync(manifestPath);
    } catch {
      // A queued event is durable; stale FIFO cleanup is best-effort.
    }
  }
}

function acquireWorkerLaunchGate(queueRoot: string): boolean {
  const gatePath = join(queueRoot, "worker-launch-gate.json");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeImmutableFile(gatePath, JSON.stringify({
        created_at: new Date().toISOString(),
        pid: process.pid,
      }));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") return false;
      try {
        if (Date.now() - statSync(gatePath).mtimeMs <= WORKER_LAUNCH_COOLDOWN_MS) return false;
        unlinkSync(gatePath);
      } catch {
        return false;
      }
    }
  }
  return false;
}

function writeWorkerHealth(queueRoot: string, value: Record<string, unknown>): void {
  const healthPath = join(queueRoot, "worker-health.json");
  const temporaryPath = join(queueRoot, `.tmp-worker-health-${randomUUID()}`);
  try {
    writeImmutableFile(temporaryPath, JSON.stringify(value));
    renameSync(temporaryPath, healthPath);
  } catch {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // Worker health is observational and must not fail the hook.
    }
  }
}

function reportWorkerSpawnError(
  queueRoot: string,
  projectRoot: string,
  workerEntry: string,
  error: unknown,
): void {
  const value = error instanceof Error ? error : new Error(String(error));
  writeWorkerHealth(queueRoot, {
    state: "spawn_error",
    project_root: projectRoot,
    worker_entry: workerEntry,
    observed_at: new Date().toISOString(),
    error: {
      name: value.name,
      message: value.message,
      code: (value as NodeJS.ErrnoException).code,
    },
  });
  try {
    process.stderr.write(`[AI Dev Companion] Worker spawn failed: ${value.message}\n`);
  } catch {
    // stderr is best-effort in hook subprocesses.
  }
}

export function spawnQueueWorker(projectRoot: string): void {
  try {
    const directories = prepareQueueDirectories(projectRoot);
    if (!directories || !acquireWorkerLaunchGate(directories.queue)) return;
    const workerEntry = fileURLToPath(new URL("../../daemon/dist/worker.js", import.meta.url));
    try {
      const child = spawn(process.execPath, [workerEntry, projectRoot], {
        shell: false,
        windowsHide: true,
        stdio: "ignore",
        detached: true,
      });
      child.once("error", (error) => {
        reportWorkerSpawnError(directories.queue, projectRoot, workerEntry, error);
      });
      writeWorkerHealth(directories.queue, {
        state: "launch_requested",
        project_root: projectRoot,
        worker_entry: workerEntry,
        requested_at: new Date().toISOString(),
        pid: child.pid ?? null,
      });
      child.unref();
    } catch (error) {
      reportWorkerSpawnError(directories.queue, projectRoot, workerEntry, error);
    }
  } catch {
    // Launching is best-effort; queued events remain durable for a later retry.
  }
}

export function enqueueCapturedEvents(
  input: ToolUseInput,
  manifests: SnapshotManifest[],
): HookEvent[] {
  const correlationId = deriveCorrelationId(input);
  const events: HookEvent[] = [];
  const rootsToLaunch = new Set<string>();

  for (const target of eventTargets(input, manifests, correlationId)) {
    const candidates = eligibleCandidates(target, correlationId, manifests);
    const selected = candidates.length === 1 ? candidates[0] : undefined;
    const after = readSnapshotTargetSafely(target.projectRoot, target.filePath);
    const directories = prepareQueueDirectories(target.projectRoot);
    if (!directories) continue;

    const eventId = randomUUID();
    let degradationReason: EventDegradationReason | undefined;
    if (candidates.length === 0) degradationReason = "snapshot-unavailable";
    else if (candidates.length > 1) degradationReason = "ambiguous-pre-manifest";
    else if (selected!.evidence_quality === "degraded") {
      degradationReason = selected!.degradation_reason ?? "snapshot-unavailable";
    } else if (!validPreSnapshot(selected!)) {
      degradationReason = "snapshot-unavailable";
    } else if (after.evidence_quality === "degraded") {
      degradationReason = after.degradation_reason;
    }

    let postSnapshotPath: string | null = null;
    if (after.evidence_quality === "full" && after.state === "present") {
      try {
        const absolutePath = join(directories.snapshots, `${eventId}.after`);
        writeImmutableFile(absolutePath, after.content);
        postSnapshotPath = relative(target.projectRoot, absolutePath).replace(/\\/g, "/");
      } catch {
        degradationReason = "read-error";
      }
    }

    const preSnapshotPath = selected?.evidence_quality === "full" && validPreSnapshot(selected)
      ? selected.pre_snapshot_path
      : null;
    const event: HookEvent = {
      schema_version: 1,
      event_id: eventId,
      correlation_id: correlationId,
      project_root: target.projectRoot,
      timestamp: new Date().toISOString(),
      tool: input.tool_name ?? "unknown",
      file_path: target.relativePath,
      operation: operationFor(selected, after.state),
      evidence_quality: degradationReason ? "degraded" : "full",
      degradation_reason: degradationReason,
      pre_snapshot_path: preSnapshotPath,
      post_snapshot_path: postSnapshotPath,
      snapshots: {
        before: preSnapshotPath
          ? { state: "present", token: basename(preSnapshotPath) }
          : selected?.before_state === "missing" ? { state: "missing" } : null,
        after: postSnapshotPath
          ? { state: "present", token: basename(postSnapshotPath) }
          : after.state === "missing" ? { state: "missing" } : null,
      },
      reason: degradationReason
        ? `auto-captured from AI agent session (degraded: ${degradationReason})`
        : "auto-captured from AI agent session",
      ecl_context: detectActiveEcl(target.projectRoot),
      five_questions: null,
      file_level: degradationReason
        ? true
        : isFileLevelExtension(extname(target.relativePath).toLowerCase()) || undefined,
    };
    const temporaryPath = join(directories.inbox, `.tmp-${eventId}`);
    const eventPath = join(directories.inbox, `${eventId}.json`);
    try {
      writeImmutableFile(temporaryPath, JSON.stringify(event));
      renameSync(temporaryPath, eventPath);
      consumeManifests(target.projectRoot, candidates);
      events.push(event);
      rootsToLaunch.add(target.projectRoot);
      emitVerificationReminder(target.projectRoot, target.filePath);
    } catch {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // Best-effort cleanup; an unreferenced temp file is recoverable.
      }
    }
  }

  for (const projectRoot of rootsToLaunch) spawnQueueWorker(projectRoot);

  return events;
}

export function handlePostToolUse(
  stdin: string,
  supportedExtensions: Set<string> = SUPPORTED_EXTENSIONS
): void {
  let input: ToolUseInput;
  try {
    input = JSON.parse(stdin.replace(/^\uFEFF/, "")) as ToolUseInput;
  } catch {
    return;
  }

  try {
    const toolName = input.tool_name;
    if (!isFileWriteTool(toolName)) return;

    const rootsToLaunch = new Set<string>();
    for (const filePath of getChangedFilePaths(input)) {
      const ext = extname(filePath).toLowerCase();
      const isAstSupported = supportedExtensions.has(ext);
      const isFileLevel = isFileLevelExtension(ext);
      // Drop only binary artifacts; AST-supported and file-level
      // extensions both get recorded into the same queue.
      if (!isAstSupported && !isFileLevel) continue;

      const projectRoot = findProjectRoot(filePath);
      if (!projectRoot) continue;

      const queueDir = join(projectRoot, QUEUE_DIR);
      if (!existsSync(queueDir)) {
        mkdirSync(queueDir, { recursive: true });
      }

      const event: HookEvent = {
        timestamp: new Date().toISOString(),
        tool: toolName ?? "unknown",
        file_path: filePath,
        pre_snapshot_path: null,
        reason: isAstSupported
          ? "auto-captured from AI agent session"
          : "auto-captured from AI agent session (file-level, no AST)",
        ecl_context: detectActiveEcl(projectRoot),
        five_questions: null,
      };
      // file-level events are flagged so the daemon can skip AST parsing.
      if (!isAstSupported) event.file_level = true;

      const queueFile = join(queueDir, "events.jsonl");
      appendFileSync(queueFile, JSON.stringify(event) + "\n");

      rootsToLaunch.add(projectRoot);
      emitVerificationReminder(projectRoot, filePath);
    }
    // Launch-gated (5s cooldown) short-lived worker to drain the queue.
    for (const projectRoot of rootsToLaunch) spawnQueueWorker(projectRoot);
  } catch (error) {
    // PostToolUse is observational. A queue failure must never fail the edit
    // that already completed or make Codex report a hook error.
    try {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[AI Dev Companion] PostToolUse skipped: ${message}\n`);
    } catch {
      // stderr itself is best-effort in hook processes.
    }
  }
}

export function findProjectRoot(filePath: string): string | null {
  let dir = resolve(filePath, "..");
  let prev = "";

  while (dir !== prev) {
    if (existsSync(join(dir, ".devcompanion"))) return dir;
    if (existsSync(join(dir, ".git"))) return dir;
    prev = dir;
    dir = resolve(dir, "..");
  }

  return null;
}

function detectActiveEcl(projectRoot: string): EclContextSlim | undefined {
  const eclDir = join(projectRoot, "docs", "ecl");
  if (!existsSync(eclDir)) return undefined;

  const files = readdirSync(eclDir).filter((f) => f.endsWith(".yaml"));
  for (const file of files) {
    try {
      const content = readFileSync(join(eclDir, file), "utf-8");
      const featureMatch = content.match(/^feature:\s*["']?(.+?)["']?$/m);
      const statusMatch = content.match(/^status:\s*["']?([^\s"']+)/m);
      if (!featureMatch || !statusMatch) continue;

      const status = statusMatch[1];
      if (isInactiveEclStatus(status)) continue;

      const feature = featureMatch[1];
      const reqIds = [...content.matchAll(/^\s*- id:\s*["']?(REQ-\d+)["']?$/gm)]
        .map((m) => m[1]);
      const decIds = [...content.matchAll(/^\s*- id:\s*["']?(DEC-\d+)["']?$/gm)]
        .map((m) => m[1]);

      return {
        feature,
        requirements: reqIds.length > 0 ? reqIds : undefined,
        decisions: decIds.length > 0 ? decIds : undefined,
        ecl_file: `docs/ecl/${file}`,
      };
    } catch {
      continue;
    }
  }
  return undefined;
}


function emitVerificationReminder(projectRoot: string, filePath: string): void {
  const eclDir = join(projectRoot, "docs", "ecl");
  if (!existsSync(eclDir)) return;

  const files = readdirSync(eclDir).filter((f) => f.endsWith(".yaml"));
  const commands: string[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(eclDir, file), "utf-8");
      for (const guard of findMatchingGuards(content, filePath)) {
        for (const cmd of guard.verifications) {
          if (!commands.includes(cmd)) commands.push(cmd);
        }
      }
    } catch {
      continue;
    }
  }

  if (commands.length > 0) {
    const list = commands.map((cmd) => `  - ${cmd}`).join("\n");
    process.stderr.write(
      `[AI Dev Companion] File edited under ECL guard. Run verification:\n${list}\n`
    );
  }
}

if (!process.stdin.isTTY) {
  let data = "";
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (chunk) => { data += chunk; });
  process.stdin.on("end", () => {
    handlePostToolUse(data);
  });
}
