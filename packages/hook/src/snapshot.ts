import { createHash, randomUUID } from "node:crypto";
import fs, { type Stats } from "node:fs";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  deriveCorrelationId,
  getChangedFilePaths,
  type ToolUseInput,
} from "./tool-event.js";

const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const SUPPORTED_TEXT_EXTENSIONS = new Set([
  ".py",
  ".pyi",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".yaml",
  ".yml",
  ".md",
]);

export type SnapshotDegradationReason =
  | "binary-or-unsupported"
  | "identity-changed"
  | "read-error"
  | "repo-escape"
  | "size-limit"
  | "storage-root-redirect"
  | "symlink-target"
  | "unsupported-extension"
  | "unsupported-file-type";

export type SnapshotReadResult =
  | {
      evidence_quality: "full";
      state: "present";
      content: string;
      size: number;
    }
  | {
      evidence_quality: "full";
      state: "missing";
      content: null;
      size: 0;
    }
  | {
      evidence_quality: "degraded";
      state: "unavailable";
      content: null;
      degradation_reason: SnapshotDegradationReason;
    };

export interface SnapshotManifest {
  correlation_id: string;
  snapshot_nonce: string;
  project_root: string;
  file_path: string;
  created_at: string;
  before_state: SnapshotReadResult["state"];
  evidence_quality: SnapshotReadResult["evidence_quality"];
  degradation_reason?: SnapshotDegradationReason;
  pre_snapshot_path: string | null;
  manifest_path: string | null;
}

function degraded(degradationReason: SnapshotDegradationReason): SnapshotReadResult {
  return {
    evidence_quality: "degraded",
    state: "unavailable",
    content: null,
    degradation_reason: degradationReason,
  };
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

function storageRootIsSafe(projectRoot: string, canonicalProjectRoot: string): boolean {
  const storagePaths = [
    resolve(projectRoot, ".devcompanion"),
    resolve(projectRoot, ".devcompanion", "queue"),
  ];

  for (const storagePath of storagePaths) {
    try {
      const metadata = fs.lstatSync(storagePath);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) return false;
      if (!isWithin(canonicalProjectRoot, fs.realpathSync.native(storagePath))) return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
      let parent = resolve(storagePath, "..");
      while (true) {
        try {
          if (!isWithin(canonicalProjectRoot, fs.realpathSync.native(parent))) return false;
          break;
        } catch (parentError) {
          if ((parentError as NodeJS.ErrnoException).code !== "ENOENT") return false;
          const next = resolve(parent, "..");
          if (next === parent) return false;
          parent = next;
        }
      }
    }
  }
  return true;
}

function sameIdentity(first: Stats, second: Stats): boolean {
  return first.dev === second.dev
    && first.ino === second.ino
    && first.size === second.size
    && first.mtimeMs === second.mtimeMs
    && first.ctimeMs === second.ctimeMs;
}

function decodeText(content: Buffer): string | null {
  if (content.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return null;
  }
}

function repoRelative(projectRoot: string, filePath: string): string {
  return relative(projectRoot, filePath).replace(/\\/g, "/");
}

function findCanonicalProjectRoot(filePath: string): string | null {
  let directory = resolve(filePath, "..");
  let previous = "";
  while (directory !== previous) {
    if (fs.existsSync(join(directory, ".devcompanion"))
      || fs.existsSync(join(directory, ".git"))) {
      try {
        return fs.realpathSync.native(directory);
      } catch {
        return null;
      }
    }
    previous = directory;
    directory = resolve(directory, "..");
  }
  return null;
}

function prepareSnapshotRoot(projectRoot: string): string | null {
  if (!storageRootIsSafe(projectRoot, projectRoot)) return null;
  const snapshotRoot = join(projectRoot, ".devcompanion", "queue", "snapshots");
  try {
    fs.mkdirSync(snapshotRoot, { recursive: true, mode: 0o700 });
    const metadata = fs.lstatSync(snapshotRoot);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) return null;
    if (!isWithin(projectRoot, fs.realpathSync.native(snapshotRoot))) return null;
    return snapshotRoot;
  } catch {
    return null;
  }
}

function writeEvidence(filePath: string, content: string): void {
  const descriptor = fs.openSync(filePath, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, content, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function persistManifest(snapshotRoot: string, manifest: SnapshotManifest): SnapshotManifest {
  const pathKey = createHash("sha256").update(manifest.file_path).digest("hex");
  const fifoRoot = join(snapshotRoot, "manifests", pathKey);
  fs.mkdirSync(fifoRoot, { recursive: true, mode: 0o700 });
  const manifestPath = join(fifoRoot, `${manifest.created_at.replace(/\D/g, "")}-${manifest.snapshot_nonce}.json`);
  const persisted = {
    ...manifest,
    manifest_path: repoRelative(manifest.project_root, manifestPath),
  };
  writeEvidence(manifestPath, JSON.stringify(persisted));
  return persisted;
}

/** Capture immutable before-state evidence and persist one FIFO manifest per path. */
export function capturePreEditSnapshots(
  input: ToolUseInput,
  projectRoot: string,
): SnapshotManifest[] {
  const correlationId = deriveCorrelationId(input);
  const manifests: SnapshotManifest[] = [];

  for (const filePath of getChangedFilePaths(input, projectRoot)) {
    const canonicalProjectRoot = findCanonicalProjectRoot(filePath);
    if (!canonicalProjectRoot) {
      process.stderr.write(`[AI Dev Companion] Snapshot skipped: no project root for ${filePath}\n`);
      continue;
    }

    const snapshotNonce = randomUUID();
    const result = readSnapshotTargetSafely(canonicalProjectRoot, filePath);
    let manifest: SnapshotManifest = {
      correlation_id: correlationId,
      snapshot_nonce: snapshotNonce,
      project_root: canonicalProjectRoot,
      file_path: repoRelative(canonicalProjectRoot, filePath),
      created_at: new Date().toISOString(),
      before_state: result.state,
      evidence_quality: result.evidence_quality,
      degradation_reason: result.evidence_quality === "degraded"
        ? result.degradation_reason
        : undefined,
      pre_snapshot_path: null,
      manifest_path: null,
    };
    const snapshotRoot = prepareSnapshotRoot(canonicalProjectRoot);
    if (!snapshotRoot) {
      manifests.push({
        ...manifest,
        before_state: "unavailable",
        evidence_quality: "degraded",
        degradation_reason: "storage-root-redirect",
      });
      continue;
    }

    try {
      if (result.evidence_quality === "full" && result.state === "present") {
        const beforePath = join(snapshotRoot, `${snapshotNonce}.before`);
        writeEvidence(beforePath, result.content);
        manifest = {
          ...manifest,
          pre_snapshot_path: repoRelative(canonicalProjectRoot, beforePath),
        };
      }
      manifests.push(persistManifest(snapshotRoot, manifest));
    } catch {
      manifests.push({
        ...manifest,
        before_state: "unavailable",
        evidence_quality: "degraded",
        degradation_reason: "read-error",
        pre_snapshot_path: null,
      });
    }
  }

  return manifests;
}

/**
 * Read one snapshot source without allowing repository/storage redirection or
 * returning bytes observed through a path-identity race.
 */
export function readSnapshotTargetSafely(
  projectRoot: string,
  filePath: string,
): SnapshotReadResult {
  let canonicalProjectRoot: string;
  try {
    canonicalProjectRoot = fs.realpathSync.native(projectRoot);
    if (!fs.statSync(canonicalProjectRoot).isDirectory()) return degraded("repo-escape");
  } catch {
    return degraded("repo-escape");
  }

  if (!storageRootIsSafe(projectRoot, canonicalProjectRoot)) {
    return degraded("storage-root-redirect");
  }

  const lexicalProjectRoot = resolve(projectRoot);
  const targetPath = isAbsolute(filePath) ? resolve(filePath) : resolve(projectRoot, filePath);
  if (!isWithin(lexicalProjectRoot, targetPath)) return degraded("repo-escape");
  if (!SUPPORTED_TEXT_EXTENSIONS.has(extname(targetPath).toLowerCase())) {
    return degraded("unsupported-extension");
  }

  let initial: Stats;
  try {
    initial = fs.lstatSync(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return degraded("read-error");
    let parent = resolve(targetPath, "..");
    while (true) {
      try {
        if (!isWithin(canonicalProjectRoot, fs.realpathSync.native(parent))) {
          return degraded("repo-escape");
        }
        return { evidence_quality: "full", state: "missing", content: null, size: 0 };
      } catch (parentError) {
        if ((parentError as NodeJS.ErrnoException).code !== "ENOENT") {
          return degraded("read-error");
        }
        const next = resolve(parent, "..");
        if (next === parent) return degraded("repo-escape");
        parent = next;
      }
    }
  }

  if (initial.isSymbolicLink()) return degraded("symlink-target");
  if (!initial.isFile()) return degraded("unsupported-file-type");
  try {
    if (!isWithin(canonicalProjectRoot, fs.realpathSync.native(targetPath))) {
      return degraded("repo-escape");
    }
  } catch {
    return degraded("read-error");
  }

  const noFollow = process.platform === "win32" ? 0 : (fs.constants.O_NOFOLLOW ?? 0);
  let descriptor: number;
  try {
    descriptor = fs.openSync(targetPath, fs.constants.O_RDONLY | noFollow);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return degraded(code === "ELOOP" ? "symlink-target" : "read-error");
  }

  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile()) return degraded("unsupported-file-type");
    if (!sameIdentity(initial, opened)) return degraded("identity-changed");
    if (opened.size > MAX_SNAPSHOT_BYTES) return degraded("size-limit");

    const content = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < content.length) {
      const count = fs.readSync(descriptor, content, offset, content.length - offset, null);
      if (count === 0) break;
      offset += count;
    }

    const afterRead = fs.fstatSync(descriptor);
    const finalPath = fs.lstatSync(targetPath);
    const finalRealPath = fs.realpathSync.native(targetPath);
    if (offset !== opened.size
      || !sameIdentity(opened, afterRead)
      || !sameIdentity(initial, finalPath)
      || !isWithin(canonicalProjectRoot, finalRealPath)) {
      return degraded("identity-changed");
    }

    const text = decodeText(content);
    if (text === null) return degraded("binary-or-unsupported");
    return { evidence_quality: "full", state: "present", content: text, size: content.length };
  } catch {
    return degraded("identity-changed");
  } finally {
    try {
      fs.closeSync(descriptor);
    } catch {
      // The read result is already content-safe; close failure must not fail the hook.
    }
  }
}
