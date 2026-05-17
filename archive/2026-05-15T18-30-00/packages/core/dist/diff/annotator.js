import { computeFunctionIdentity } from "@aidev/ast";
import { randomUUID } from "node:crypto";
export function annotateChanges(diffs, functionMap, context) {
    const annotations = [];
    for (const diff of diffs) {
        const functions = functionMap.get(diff.file_path) ?? [];
        for (const hunk of diff.hunks) {
            const affectedFunctions = findAffectedFunctions(hunk, functions);
            if (affectedFunctions.length === 0) {
                annotations.push({
                    file_path: diff.file_path,
                    function_name: "<module-level>",
                    function_hash: `module::${diff.file_path}`,
                    class_name: null,
                    change_type: inferChangeType(diff, hunk),
                    reason: context.reason,
                    reason_source: context.reason_source,
                    hunks: [hunk],
                    start_line: hunk.new_start,
                    end_line: hunk.new_start + hunk.new_count,
                });
            }
            else {
                for (const fn of affectedFunctions) {
                    const identity = computeFunctionIdentity(diff.file_path, fn);
                    annotations.push({
                        file_path: diff.file_path,
                        function_name: fn.name,
                        function_hash: identity.hash,
                        class_name: fn.class_name,
                        change_type: inferChangeType(diff, hunk),
                        reason: context.reason,
                        reason_source: context.reason_source,
                        hunks: [hunk],
                        start_line: fn.start_line,
                        end_line: fn.end_line,
                    });
                }
            }
        }
    }
    return deduplicateByFunction(annotations);
}
export function toChangeRecords(annotations, sessionId) {
    return annotations.map((a) => ({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        file_path: a.file_path,
        function_hash: a.function_hash,
        function_name: a.function_name,
        class_name: a.class_name,
        change_type: a.change_type,
        reason: a.reason,
        reason_source: a.reason_source,
        old_content: extractOldContent(a.hunks),
        new_content: extractNewContent(a.hunks),
        start_line: a.start_line,
        end_line: a.end_line,
        test_status: "pending",
        test_file: null,
        error_id: null,
        session_id: sessionId,
    }));
}
function findAffectedFunctions(hunk, functions) {
    const hunkStart = hunk.new_start;
    const hunkEnd = hunk.new_start + hunk.new_count;
    return functions.filter((fn) => fn.start_line <= hunkEnd && fn.end_line >= hunkStart);
}
function inferChangeType(diff, _hunk) {
    if (diff.status === "added")
        return "add";
    if (diff.status === "deleted")
        return "delete";
    if (diff.status === "renamed")
        return "rename";
    return "modify";
}
export function deduplicateByFunction(annotations) {
    const byKey = new Map();
    for (const a of annotations) {
        const key = `${a.file_path}::${a.function_hash}`;
        const existing = byKey.get(key);
        if (existing) {
            existing.hunks.push(...a.hunks);
            existing.start_line = Math.min(existing.start_line, a.start_line);
            existing.end_line = Math.max(existing.end_line, a.end_line);
        }
        else {
            byKey.set(key, { ...a });
        }
    }
    return Array.from(byKey.values());
}
function extractOldContent(hunks) {
    return hunks
        .flatMap((h) => h.lines.filter((l) => l.type === "delete").map((l) => l.content))
        .join("\n");
}
function extractNewContent(hunks) {
    return hunks
        .flatMap((h) => h.lines.filter((l) => l.type === "add").map((l) => l.content))
        .join("\n");
}
//# sourceMappingURL=annotator.js.map