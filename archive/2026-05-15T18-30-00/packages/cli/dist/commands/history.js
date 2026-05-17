import { Command } from "commander";
import { resolve } from "node:path";
import { HistoryStore } from "@aidev/history";
export const historyCommand = new Command("history")
    .description("Query change history for files and functions")
    .argument("[target]", "File path or function name to query")
    .option("-p, --project <path>", "Project root path", ".")
    .option("--function <hash>", "Query by function hash")
    .option("--list-sessions", "List recent review sessions")
    .option("-n, --limit <number>", "Number of results", "10")
    .action(async (target, opts) => {
    const projectRoot = resolve(opts.project);
    const store = new HistoryStore(projectRoot);
    if (opts.listSessions) {
        const sessions = await store.listSessions(parseInt(opts.limit));
        console.log("Recent review sessions:");
        for (const s of sessions) {
            console.log(`  ${s}`);
        }
        return;
    }
    if (opts.function) {
        const records = await store.getFunctionHistory(opts.function);
        if (records.length === 0) {
            console.log(`No history found for function hash: ${opts.function}`);
            return;
        }
        console.log(`History for function (${records.length} records):`);
        for (const r of records.slice(0, parseInt(opts.limit))) {
            console.log(`  [${r.timestamp}] ${r.change_type} — ${r.reason}`);
            console.log(`    Test: ${r.test_status}${r.error_id ? ` | Error: #${r.error_id}` : ""}`);
        }
        return;
    }
    if (target) {
        const filePath = resolve(projectRoot, target);
        const history = await store.getFileHistory(filePath);
        if (!history) {
            console.log(`No history found for: ${target}`);
            return;
        }
        console.log(`History for ${target} (${history.total_records} total records):`);
        for (const [hash, fnHistory] of Object.entries(history.functions)) {
            const latest = fnHistory.records[fnHistory.records.length - 1];
            console.log(`  ${fnHistory.function_name} [${hash.slice(0, 8)}] — ${fnHistory.records.length} changes, last: ${latest?.timestamp ?? "?"}`);
        }
        return;
    }
    const index = await store.getIndex();
    console.log(`Project: ${index.project_root}`);
    console.log(`Total sessions: ${index.total_sessions}`);
    console.log(`Total changes: ${index.total_changes}`);
    console.log(`Tracked functions: ${Object.keys(index.function_index).length}`);
});
//# sourceMappingURL=history.js.map