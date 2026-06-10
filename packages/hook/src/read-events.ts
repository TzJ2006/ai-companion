import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { findProjectRoot, type HookEvent } from "./index.js";

// FN MVP-HOOK-READER: the PostToolUse hook writes a JSONL audit trail
// (`.devcompanion/queue/events.jsonl`). Without a reader the trail is
// write-only. `readEvents` parses that queue and returns the recorded
// events for a single target file path.
//
// Must match the writer in `index.ts`: same relative queue location and the
// same `HookEvent` shape (notably the `file_path` field, not `path`).
const QUEUE_DIR = ".devcompanion/queue";
const QUEUE_FILE = "events.jsonl";

export interface ReadEventsOptions {
  // Explicit project root (skips findProjectRoot). For testability.
  projectRoot?: string;
  // Explicit queue directory (overrides projectRoot-derived path). For
  // testability — point straight at a temp `queue/` dir.
  queueDir?: string;
}

/**
 * Read the hook audit trail and return the `HookEvent`s recorded for
 * `targetFilePath`.
 *
 * The queue directory is resolved in priority order:
 *   1. `options.queueDir` (if provided)
 *   2. `options.projectRoot` + `.devcompanion/queue` (if provided)
 *   3. `findProjectRoot(targetFilePath)` + `.devcompanion/queue`
 *
 * Defensive by design: a missing/empty queue, an unresolvable project root,
 * or malformed JSONL lines yield `[]` (and bad lines are skipped) rather than
 * throwing.
 */
export function readEvents(
  targetFilePath: string,
  options: ReadEventsOptions = {}
): HookEvent[] {
  const queueDir = resolveQueueDir(targetFilePath, options);
  if (!queueDir) return [];

  const queueFile = join(queueDir, QUEUE_FILE);
  if (!existsSync(queueFile)) return [];

  let raw: string;
  try {
    raw = readFileSync(queueFile, "utf-8");
  } catch {
    return [];
  }

  const events: HookEvent[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let event: HookEvent;
    try {
      event = JSON.parse(trimmed) as HookEvent;
    } catch {
      // Skip malformed lines; never let one bad row break the whole read.
      continue;
    }
    if (event && event.file_path === targetFilePath) {
      events.push(event);
    }
  }
  return events;
}

function resolveQueueDir(
  targetFilePath: string,
  options: ReadEventsOptions
): string | null {
  if (options.queueDir) return options.queueDir;
  const root = options.projectRoot ?? findProjectRoot(targetFilePath);
  if (!root) return null;
  return join(root, QUEUE_DIR);
}
