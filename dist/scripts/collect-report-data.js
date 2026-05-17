#!/usr/bin/env npx tsx
"use strict";
/**
 * Collect test results + LLM-generated function reasons for the onboard report.
 * Outputs .devcompanion/report-data.json
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectTestResults = collectTestResults;
exports.generateFunctionReason = generateFunctionReason;
exports.generateHeuristicReason = generateHeuristicReason;
exports.getTestFileName = getTestFileName;
exports.main = main;
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const index_ts_1 = require("../packages/ast/src/index.ts");
const exec = (0, node_util_1.promisify)(node_child_process_1.execFile);
const PROJECT_ROOT = (0, node_path_1.resolve)(import.meta.dirname, "..");
/** @internal */
async function collectTestResults() {
    console.log("Running tests...");
    const results = new Map();
    let stdout = "";
    try {
        const result = await exec("npx", ["vitest", "run", ".devcompanion/tests/", "--reporter=json"], {
            cwd: PROJECT_ROOT,
            maxBuffer: 10 * 1024 * 1024,
            timeout: 120000,
            shell: true,
        });
        stdout = result.stdout;
    }
    catch (e) {
        stdout = e.stdout ?? "";
    }
    try {
        const jsonStart = stdout.indexOf("{");
        if (jsonStart >= 0) {
            const data = JSON.parse(stdout.slice(jsonStart));
            for (const suite of data.testResults ?? []) {
                const fileName = suite.name.split(/[/\\]/).pop();
                const assertions = (suite.assertionResults || []).map((a) => ({
                    name: a.fullName || a.title || "unknown",
                    status: a.status === "passed" ? "passed" : "failed",
                    failure_message: a.failureMessages?.[0]?.split("\n")[0],
                }));
                results.set(fileName, {
                    test_file: fileName,
                    suite_status: suite.status === "passed" ? "passed" : "failed",
                    assertions,
                    error_message: suite.message?.split("\n")[0],
                });
            }
        }
    }
    catch {
        console.warn("Failed to parse test output");
    }
    console.log(`  Collected results for ${results.size} test suites`);
    return results;
}
/** @internal */
async function generateFunctionReason(fn, filePath) {
    const params = fn.params.map(p => `${p.name}: ${p.type ?? "any"}`).join(", ");
    const sig = `${fn.is_async ? "async " : ""}${fn.class_name ? fn.class_name + "." : ""}${fn.name}(${params})${fn.return_type ? ": " + fn.return_type : ""}`;
    const prompt = `Given this function signature from file "${filePath}":
${sig}
${fn.docstring ? `Docstring: ${fn.docstring}` : ""}

In ONE sentence (max 20 words), explain what this function likely does. Be specific and technical. Output ONLY the sentence, no quotes, no period at end.`;
    try {
        const { stdout } = await exec("claude", ["-p", prompt], {
            timeout: 15000,
            maxBuffer: 1024 * 1024,
        });
        const line = stdout.trim().split("\n")[0].replace(/^["']|["']$/g, "").replace(/\.$/, "");
        return line || `Processes ${fn.params.length > 0 ? fn.params[0].name : "data"} and returns ${fn.return_type ?? "result"}`;
    }
    catch {
        // Fallback: generate heuristic reason
        return generateHeuristicReason(fn);
    }
}
/** @internal */
function generateHeuristicReason(fn) {
    const name = fn.name;
    const params = fn.params.map(p => p.name).join(", ");
    if (name.startsWith("get") || name.startsWith("fetch")) {
        const what = name.replace(/^(get|fetch)/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase();
        return `Retrieves ${what || "data"} based on ${params || "current state"}`;
    }
    if (name.startsWith("set") || name.startsWith("update")) {
        const what = name.replace(/^(set|update)/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase();
        return `Updates ${what || "value"} with provided ${params || "data"}`;
    }
    if (name.startsWith("parse")) {
        return `Parses ${params || "input"} into structured ${fn.return_type ?? "data"}`;
    }
    if (name.startsWith("render")) {
        return `Renders ${params || "content"} into ${fn.return_type ?? "output format"}`;
    }
    if (name.startsWith("init") || name.startsWith("create")) {
        return `Initializes ${(fn.class_name ?? name.replace(/^(init|create)/, "").toLowerCase()) || "instance"}`;
    }
    if (name.startsWith("is") || name.startsWith("has") || name.startsWith("can")) {
        return `Checks whether ${name.replace(/^(is|has|can)/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase()}`;
    }
    if (name.startsWith("compute") || name.startsWith("calculate")) {
        return `Computes ${name.replace(/^(compute|calculate)/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase()} from ${params || "inputs"}`;
    }
    if (name.startsWith("write") || name.startsWith("save")) {
        return `Persists ${params || "data"} to storage`;
    }
    if (name.startsWith("read") || name.startsWith("load")) {
        return `Reads ${fn.return_type ?? "data"} from ${params || "source"}`;
    }
    if (fn.is_method && fn.class_name) {
        return `${fn.class_name} method that processes ${params || "request"}`;
    }
    return `Handles ${name.replace(/([A-Z])/g, " $1").trim().toLowerCase()} operation`;
}
/** @internal */
function getTestFileName(filePath, fnName, className) {
    const fileBase = filePath.split("/").pop()?.replace(/\.(ts|tsx|py)$/, "") ?? "";
    const module = fileBase.split("/").pop() ?? fileBase;
    if (className) {
        return `test_${module}_${className}.test.ts`;
    }
    return `test_${module}_${fnName}.test.ts`;
}
/** @internal */
async function main() {
    const testResults = await collectTestResults();
    // Scan project for all functions
    console.log("Scanning project...");
    const extensions = new Set((0, index_ts_1.getSupportedExtensions)());
    const { readdir } = await import("node:fs/promises");
    const { extname } = await import("node:path");
    const IGNORED_DIRS = new Set([
        "node_modules", ".git", ".devcompanion", "dist", "build",
        "__pycache__", ".venv", "coverage", ".next",
    ]);
    async function collectFiles(dir) {
        const files = [];
        async function walk(current) {
            const entries = await readdir(current, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name.startsWith("."))
                    continue;
                const full = (0, node_path_1.resolve)(current, entry.name);
                if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name)) {
                    await walk(full);
                }
                else if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) {
                    files.push(full);
                }
            }
        }
        await walk(dir);
        return files;
    }
    const files = await collectFiles(PROJECT_ROOT);
    console.log(`  Found ${files.length} source files`);
    const allFunctions = [];
    for (const file of files) {
        try {
            const parsed = await (0, index_ts_1.parseFileAuto)(file);
            const relPath = (0, node_path_1.relative)(PROJECT_ROOT, file);
            for (const fn of parsed.functions) {
                allFunctions.push({ fn, filePath: relPath });
            }
            for (const cls of parsed.classes) {
                for (const method of cls.methods) {
                    allFunctions.push({ fn: method, filePath: relPath });
                }
            }
        }
        catch {
            // skip unparseable files
        }
    }
    console.log(`  Found ${allFunctions.length} functions`);
    console.log("Generating reasons with LLM...");
    const functions = [];
    let llmCalls = 0;
    for (const { fn, filePath } of allFunctions) {
        const testFile = getTestFileName(filePath, fn.name, fn.class_name);
        const testResult = testResults.get(testFile);
        const params = fn.params.map(p => `${p.name}: ${p.type ?? "any"}`).join(", ");
        const signature = `${fn.is_async ? "async " : ""}${fn.class_name ? fn.class_name + "." : ""}${fn.name}(${params})${fn.return_type ? ": " + fn.return_type : ""}`;
        // Generate reason: use LLM if --llm flag, otherwise heuristic
        const useLlm = process.argv.includes("--llm");
        let reason;
        let reason_source;
        if (useLlm && llmCalls < 20) {
            reason = await generateFunctionReason(fn, filePath);
            reason_source = "llm-inferred";
            llmCalls++;
            if (llmCalls % 10 === 0)
                console.log(`  Generated ${llmCalls} reasons...`);
        }
        else {
            reason = generateHeuristicReason(fn);
            reason_source = useLlm ? "heuristic" : "heuristic";
        }
        const td = [];
        if (testResult && testResult.assertions) {
            for (let i = 0; i < testResult.assertions.length; i++) {
                const a = testResult.assertions[i];
                td.push({ name: a.name, status: a.status, reason: a.failure_message });
            }
        }
        functions.push({
            file_path: filePath,
            function_name: fn.name,
            class_name: fn.class_name,
            signature: signature,
            reason: reason,
            reason_source: reason_source,
            test_file: testResult ? testFile : null,
            test_status: testResult ? testResult.suite_status : "no-test",
            test_details: td,
        });
    }
    const report = {
        generated_at: new Date().toISOString(),
        total_functions: functions.length,
        total_tests: testResults.size,
        tests_passed: [...testResults.values()].filter(t => t.suite_status === "passed").length,
        tests_failed: [...testResults.values()].filter(t => t.suite_status === "failed").length,
        functions,
    };
    const outPath = (0, node_path_1.resolve)(PROJECT_ROOT, ".devcompanion/report-data.json");
    await (0, promises_1.writeFile)(outPath, JSON.stringify(report, null, 2));
    console.log(`\nReport data written to: ${outPath}`);
    console.log(`  Functions: ${report.total_functions}`);
    console.log(`  Tests passed: ${report.tests_passed}/${report.total_tests}`);
}
main().catch(console.error);
//# sourceMappingURL=collect-report-data.js.map