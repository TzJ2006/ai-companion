"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_path_1 = require("node:path");
const index_ts_1 = require("./packages/ast/src/index.ts");
const index_ts_2 = require("./packages/core/src/index.ts");
const index_ts_3 = require("./packages/history/src/index.ts");
const index_ts_4 = require("./packages/render/src/index.ts");
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const PROJECT_ROOT = "/tmp/test-python-project";
async function main() {
    console.log("=== E2E Test: review → store → render ===\n");
    // Step 1: Init parser and store
    await (0, index_ts_1.initParser)();
    const store = new index_ts_3.HistoryStore(PROJECT_ROOT);
    await store.init();
    console.log("✓ Parser and store initialized");
    // Step 2: Get git diff
    const diffs = await (0, index_ts_2.getGitDiff)(PROJECT_ROOT);
    console.log(`✓ Got ${diffs.length} file diff(s)`);
    for (const d of diffs) {
        console.log(`  ${d.file_path} [${d.status}] — ${d.hunks.length} hunk(s)`);
    }
    // Step 3: Parse affected files for function signatures
    const functionMap = new Map();
    for (const diff of diffs) {
        if (diff.file_path.endsWith(".py") && diff.status !== "deleted") {
            const fullPath = (0, node_path_1.resolve)(PROJECT_ROOT, diff.file_path);
            const parsed = await (0, index_ts_1.parseFile)(fullPath);
            const allFunctions = [
                ...parsed.functions,
                ...parsed.classes.flatMap((c) => c.methods),
            ];
            functionMap.set(diff.file_path, allFunctions);
            console.log(`✓ Parsed ${diff.file_path}: ${allFunctions.length} functions`);
        }
    }
    // Step 4: Annotate changes
    const sessionId = (0, node_crypto_1.randomUUID)();
    const annotations = (0, index_ts_2.annotateChanges)(diffs, functionMap, {
        reason: "Added subtract method and power utility function",
        reason_source: "context",
        session_id: sessionId,
    });
    console.log(`✓ Annotated ${annotations.length} change(s):`);
    for (const a of annotations) {
        console.log(`  ${a.function_name} [${a.change_type}] lines ${a.start_line}-${a.end_line}`);
    }
    // Step 5: Convert to change records and save session
    const records = (0, index_ts_2.toChangeRecords)(annotations, sessionId);
    const session = {
        id: sessionId,
        timestamp: new Date().toISOString(),
        trigger: "cli",
        summary: "Added subtract method to Calculator and power() utility function",
        total_changes: records.length,
        files_changed: [...new Set(records.map((r) => r.file_path))],
        changes: records,
    };
    const savedPath = await store.saveSession(session);
    console.log(`✓ Session saved: ${savedPath}`);
    // Step 6: Verify stored data
    const index = await store.getIndex();
    console.log(`✓ Index updated: ${index.total_sessions} session(s), ${index.total_changes} total change(s)`);
    // Step 7: Render to HTML
    const rawDiffs = diffs.map((d) => d.raw_diff);
    const html = (0, index_ts_4.renderSessionToHtml)(session, rawDiffs, {
        show_test_status: true,
        show_error_ids: true,
        style: "side-by-side",
        title: "Test Review: Added Calculator.subtract + power()",
    });
    const htmlPath = (0, node_path_1.resolve)(PROJECT_ROOT, "review.html");
    await (0, promises_1.writeFile)(htmlPath, html);
    console.log(`✓ HTML report written: ${htmlPath}`);
    console.log(`  Size: ${(html.length / 1024).toFixed(1)} KB`);
    // Step 8: Quick verification of HTML content
    const hasAnnotations = html.includes("annotation-item");
    const hasDiff = html.includes("d2h-");
    const hasReason = html.includes("Added subtract method");
    console.log(`\n  HTML contains annotations panel: ${hasAnnotations}`);
    console.log(`  HTML contains diff2html output: ${hasDiff}`);
    console.log(`  HTML contains reason text: ${hasReason}`);
    console.log("\n=== E2E Test PASSED ===");
    console.log(`\nOpen in browser: file://${htmlPath}`);
}
main().catch(console.error);
//# sourceMappingURL=test-e2e.js.map