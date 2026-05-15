import { Command } from "commander";
import { resolve } from "node:path";
import { getGitDiff, annotateChanges, toChangeRecords } from "@aidev/core";
import { parseFileAuto, getSupportedExtensions } from "@aidev/ast";
import { HistoryStore } from "@aidev/history";
import { randomUUID } from "node:crypto";
export const reviewCommand = new Command("review")
    .description("Analyze git diff and generate structured change records")
    .option("-r, --reason <reason>", "Reason for changes (from AI context or user-provided)")
    .option("--staged", "Analyze staged changes only")
    .option("--commit <sha>", "Analyze a specific commit")
    .option("-p, --project <path>", "Project root path", ".")
    .action(async (opts) => {
    const projectRoot = resolve(opts.project);
    const store = new HistoryStore(projectRoot);
    await store.init();
    console.log("Analyzing changes...");
    const diffs = await getGitDiff(projectRoot, {
        staged: opts.staged,
        commit: opts.commit,
    });
    if (diffs.length === 0) {
        console.log("No changes detected.");
        return;
    }
    const supportedExts = getSupportedExtensions();
    const functionMap = new Map();
    for (const diff of diffs) {
        const isSupported = supportedExts.some((ext) => diff.file_path.endsWith(ext));
        if (isSupported && diff.status !== "deleted") {
            try {
                const parsed = await parseFileAuto(resolve(projectRoot, diff.file_path));
                const allFunctions = [
                    ...parsed.functions,
                    ...parsed.classes.flatMap((c) => c.methods),
                ];
                functionMap.set(diff.file_path, allFunctions);
            }
            catch {
                functionMap.set(diff.file_path, []);
            }
        }
    }
    const sessionId = randomUUID();
    const annotations = annotateChanges(diffs, functionMap, {
        reason: opts.reason ?? "No reason provided (use --reason or hook for auto-capture)",
        reason_source: opts.reason ? "user-provided" : "context",
        session_id: sessionId,
    });
    const records = toChangeRecords(annotations, sessionId);
    const session = {
        id: sessionId,
        timestamp: new Date().toISOString(),
        trigger: "cli",
        summary: `${records.length} function-level changes across ${diffs.length} files`,
        total_changes: records.length,
        files_changed: [...new Set(records.map((r) => r.file_path))],
        changes: records,
    };
    const savedPath = await store.saveSession(session);
    console.log(`Review saved: ${savedPath}`);
    console.log(`  ${records.length} changes recorded`);
    console.log(`  Files: ${session.files_changed.join(", ")}`);
});
//# sourceMappingURL=review.js.map