import { createHash } from "node:crypto";
import type { FileHistory, ProjectIndex, ReviewSession } from "./types.js";

export interface ProjectionManifest {
  dirty: boolean;
  projected_session_ids: string[];
  journal_count: number;
  journal_hash: string;
  index_digest: string;
  history_inventory: Array<{ path: string; digest: string }>;
}

export interface ProjectionStorage {
  readManifest(): Promise<ProjectionManifest | null>;
  writeManifest(manifest: ProjectionManifest): Promise<void>;
  readIndex(): Promise<ProjectIndex>;
  writeIndex(index: ProjectIndex): Promise<void>;
  readFileHistory(filePath: string): Promise<FileHistory | null>;
  writeFileHistory(filePath: string, history: FileHistory): Promise<void>;
}

export class ProjectionError extends Error {
  constructor(sessionId: string, cause: unknown) {
    super(`Failed to project session ${sessionId}`, { cause });
    this.name = "ProjectionError";
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function projectionDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

const EMPTY_MANIFEST: ProjectionManifest = {
  dirty: false,
  projected_session_ids: [],
  journal_count: 0,
  journal_hash: projectionDigest([]),
  index_digest: "",
  history_inventory: [],
};

/** Incrementally project one immutable journal session into derived history data. */
export async function projectSession(
  session: ReviewSession,
  storage: ProjectionStorage,
): Promise<ProjectionManifest> {
  try {
    const current = await storage.readManifest() ?? EMPTY_MANIFEST;
    if (current.projected_session_ids.includes(session.id)) return current;
    if (current.dirty) throw new Error("projection manifest is dirty");

    await storage.writeManifest({ ...current, dirty: true });

    const index = structuredClone(await storage.readIndex());
    index.total_sessions++;
    index.total_changes += session.total_changes;
    index.last_updated = session.timestamp;
    for (const change of session.changes) {
      index.function_index[change.function_hash] = {
        hash: change.function_hash,
        file_path: change.file_path,
        function_name: change.function_name,
        class_name: change.class_name,
        last_modified: change.timestamp,
        change_count: (index.function_index[change.function_hash]?.change_count ?? 0) + 1,
        test_status: change.test_status,
      };
    }
    await storage.writeIndex(index);

    const byFile = new Map<string, typeof session.changes>();
    for (const change of session.changes) {
      const changes = byFile.get(change.file_path) ?? [];
      changes.push(change);
      byFile.set(change.file_path, changes);
    }

    const inventory = new Map(current.history_inventory.map((item) => [item.path, item.digest]));
    for (const filePath of [...byFile.keys()].sort(compareText)) {
      const changes = byFile.get(filePath)!;
      const history = structuredClone(await storage.readFileHistory(filePath)) ?? {
        file_path: filePath,
        last_updated: changes[0].timestamp,
        total_records: 0,
        functions: {},
      };
      for (const change of changes) {
        const fn = history.functions[change.function_hash] ??= {
          function_hash: change.function_hash,
          function_name: change.function_name,
          class_name: change.class_name,
          records: [],
          prev_hashes: [],
        };
        fn.records.push(change);
        history.total_records++;
        history.last_updated = change.timestamp;
      }
      await storage.writeFileHistory(filePath, history);
      inventory.set(filePath, projectionDigest(history));
    }

    const complete: ProjectionManifest = {
      dirty: false,
      projected_session_ids: [...current.projected_session_ids, session.id].sort(),
      journal_count: current.journal_count + 1,
      journal_hash: projectionDigest([current.journal_hash, session]),
      index_digest: projectionDigest(index),
      history_inventory: [...inventory]
        .sort(([left], [right]) => compareText(left, right))
        .map(([path, itemDigest]) => ({ path, digest: itemDigest })),
    };
    await storage.writeManifest(complete);
    return complete;
  } catch (cause) {
    if (cause instanceof ProjectionError) throw cause;
    throw new ProjectionError(session.id, cause);
  }
}
