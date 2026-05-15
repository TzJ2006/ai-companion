import { readFile, writeFile, rename } from "node:fs/promises";
import { existsSync, watchFile } from "node:fs";
import { join, resolve } from "node:path";
import { getGitDiff, annotateChanges, toChangeRecords } from "@aidev/core";
import { initParser, parseFile } from "@aidev/ast";
import { HistoryStore } from "@aidev/history";
import type { ReviewSession } from "@aidev/history";
import type { FunctionSignature } from "@aidev/ast";
import { randomUUID } from "node:crypto";

interface QueueEvent {
  timestamp: string;
  tool: string;
  file_path: string;
  pre_snapshot_path: string | null;
  reason: string;
}

export async function startDaemon(projectRoot: string): Promise<void> {
  const queueFile = join(projectRoot, ".devcompanion/queue/events.jsonl");
  const store = new HistoryStore(projectRoot);
  await store.init();
  await initParser();

  console.log(`[daemon] Watching: ${queueFile}`);

  const processQueue = async () => {
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

    const functionMap = new Map<string, FunctionSignature[]>();
    for (const diff of relevantDiffs) {
      if (diff.file_path.endsWith(".py") && diff.status !== "deleted") {
        try {
          const parsed = await parseFile(resolve(projectRoot, diff.file_path));
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
    const annotations = annotateChanges(relevantDiffs, functionMap, {
      reason,
      reason_source: "context",
      session_id: sessionId,
    });

    const records = toChangeRecords(annotations, sessionId);

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
  };

  watchFile(queueFile, { interval: 2000 }, () => {
    processQueue().catch((err) => {
      console.error("[daemon] Error processing queue:", err);
    });
  });

  console.log("[daemon] Running. Press Ctrl+C to stop.");
}

const projectRoot = process.argv[2] ?? process.cwd();
startDaemon(resolve(projectRoot)).catch(console.error);
