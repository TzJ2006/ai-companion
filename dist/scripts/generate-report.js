#!/usr/bin/env npx tsx
"use strict";
/**
 * Generate the onboard report HTML with function reasons and test results.
 * Reads .devcompanion/report-data.json (from collect-report-data.ts) and renders HTML.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectFiles = collectFiles;
exports.main = main;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const promises_2 = require("node:fs/promises");
const index_ts_1 = require("../packages/ast/src/index.ts");
const index_ts_2 = require("../packages/render/src/onboard/index.ts");
const PROJECT_ROOT = (0, node_path_1.resolve)(import.meta.dirname, "..");
const IGNORED_DIRS = new Set([
    "node_modules", ".git", ".devcompanion", "dist", "build",
    "__pycache__", ".venv", "coverage", ".next",
]);
/** @internal */
async function collectFiles(dir, extensions) {
    const files = [];
    async function walk(current) {
        const entries = await (0, promises_2.readdir)(current, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith("."))
                continue;
            const full = (0, node_path_1.resolve)(current, entry.name);
            if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name)) {
                await walk(full);
            }
            else if (entry.isFile() && extensions.has((0, node_path_1.extname)(entry.name).toLowerCase())) {
                files.push(full);
            }
        }
    }
    await walk(dir);
    return files;
}
/** @internal */
async function main() {
    // Load report data if available
    let reportData;
    const reportDataPath = (0, node_path_1.resolve)(PROJECT_ROOT, ".devcompanion/report-data.json");
    try {
        const raw = await (0, promises_1.readFile)(reportDataPath, "utf-8");
        reportData = JSON.parse(raw);
        console.log(`Loaded report data: ${reportData.total_functions} functions, ${reportData.tests_passed}/${reportData.total_tests} tests passed`);
    }
    catch {
        console.log("No report-data.json found. Run scripts/collect-report-data.ts first for full report.");
        console.log("Generating basic report without reasons/test results...");
    }
    // Scan and parse project
    const extensions = new Set((0, index_ts_1.getSupportedExtensions)());
    const files = await collectFiles(PROJECT_ROOT, extensions);
    console.log(`Scanning ${files.length} source files...`);
    const modules = [];
    const functionIndex = {};
    for (const file of files) {
        try {
            const parsed = await (0, index_ts_1.parseFileAuto)(file);
            parsed.file_path = (0, node_path_1.relative)(PROJECT_ROOT, file);
            modules.push(parsed);
            for (const fn of parsed.functions) {
                const identity = (0, index_ts_1.computeFunctionIdentity)(parsed.file_path, fn);
                functionIndex[identity.hash] = {
                    hash: identity.hash,
                    file_path: parsed.file_path,
                    function_name: fn.name,
                    class_name: fn.class_name,
                    last_modified: new Date().toISOString(),
                    change_count: 0,
                    test_status: "pending",
                };
            }
            for (const cls of parsed.classes) {
                for (const method of cls.methods) {
                    const identity = (0, index_ts_1.computeFunctionIdentity)(parsed.file_path, method);
                    functionIndex[identity.hash] = {
                        hash: identity.hash,
                        file_path: parsed.file_path,
                        function_name: method.name,
                        class_name: method.class_name,
                        last_modified: new Date().toISOString(),
                        change_count: 0,
                        test_status: "pending",
                    };
                }
            }
        }
        catch (e) {
            console.warn(`  Skip: ${(0, node_path_1.relative)(PROJECT_ROOT, file)} (${e.message})`);
        }
    }
    const index = {
        project_root: PROJECT_ROOT,
        last_updated: new Date().toISOString(),
        total_sessions: 0,
        total_changes: 0,
        function_index: functionIndex,
    };
    const html = (0, index_ts_2.renderOnboardHtml)(index, {
        title: "AI Dev Companion — Onboarding Report",
        project_root: PROJECT_ROOT,
        modules,
        reportData,
    });
    const outPath = (0, node_path_1.resolve)(PROJECT_ROOT, "onboard-report.html");
    await (0, promises_1.writeFile)(outPath, html);
    console.log(`\nReport written to: ${outPath}`);
}
main().catch(console.error);
//# sourceMappingURL=generate-report.js.map