"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_path_1 = require("node:path");
const ROOT = import.meta.dirname;
const config = {
    projectRoot: ROOT,
    modules: {
        ast: {
            path: (0, node_path_1.resolve)(ROOT, "packages/ast/src"),
            description: "AST parsing, identity hashing, multi-lang support",
            entryPoint: "index.ts",
            exports: [
                { name: "parseFile", kind: "function", signature: "(filePath: string) => Promise<ParsedModule>" },
                { name: "parseFileAuto", kind: "function", signature: "(filePath: string) => Promise<ParsedModule>" },
                { name: "computeFunctionIdentity", kind: "function", signature: "(filePath: string, fn: FunctionSignature) => FunctionIdentity" },
                { name: "getSupportedExtensions", kind: "function", signature: "() => string[]" },
                { name: "ParsedModule", kind: "type" },
                { name: "FunctionSignature", kind: "type" },
                { name: "FunctionIdentity", kind: "type" },
            ],
            dependencies: [],
        },
        core: {
            path: (0, node_path_1.resolve)(ROOT, "packages/core/src"),
            description: "Business logic: diff parsing, annotation, test generation",
            entryPoint: "index.ts",
            exports: [
                { name: "parseUnifiedDiff", kind: "function", signature: "(raw: string) => FileDiff[]" },
                { name: "annotateChanges", kind: "function", signature: "(diffs: FileDiff[], functionMap: Map, ctx: AnnotationContext) => ChangeAnnotation[]" },
                { name: "toChangeRecords", kind: "function", signature: "(annotations: ChangeAnnotation[], sessionId: string) => ChangeRecord[]" },
                { name: "generateTestSkeleton", kind: "function", signature: "(module: ParsedModule, outputDir: string) => Promise<string[]>" },
                { name: "FileDiff", kind: "type" },
                { name: "ChangeAnnotation", kind: "type" },
                { name: "ChangeRecord", kind: "type" },
            ],
            dependencies: [
                { module: "ast", imports: ["ParsedModule", "FunctionSignature", "computeFunctionIdentity"] },
            ],
        },
        render: {
            path: (0, node_path_1.resolve)(ROOT, "packages/render/src"),
            description: "HTML report rendering (session view, onboard view)",
            entryPoint: "index.ts",
            exports: [
                { name: "renderOnboardHtml", kind: "function", signature: "(index: ProjectIndex, options: OnboardRenderOptions) => string" },
                { name: "renderSessionToHtml", kind: "function", signature: "(session: SessionData) => string" },
                { name: "ReportData", kind: "type" },
                { name: "OnboardRenderOptions", kind: "type" },
            ],
            dependencies: [
                { module: "history", imports: ["ProjectIndex"] },
                { module: "ast", imports: ["ParsedModule"] },
            ],
        },
        history: {
            path: (0, node_path_1.resolve)(ROOT, "packages/history/src"),
            description: "Change history storage and indexing",
            entryPoint: "index.ts",
            exports: [
                { name: "HistoryStore", kind: "class" },
                { name: "ProjectIndex", kind: "type" },
                { name: "FunctionIndexEntry", kind: "type" },
            ],
            dependencies: [],
        },
        cli: {
            path: (0, node_path_1.resolve)(ROOT, "packages/cli/src"),
            description: "CLI commands (onboard, render)",
            entryPoint: "commands/",
            exports: [],
            dependencies: [
                { module: "ast", imports: ["parseFileAuto", "getSupportedExtensions"] },
                { module: "core", imports: ["generateTestSkeleton"] },
                { module: "render", imports: ["renderOnboardHtml"] },
                { module: "history", imports: ["HistoryStore"] },
            ],
        },
        hook: {
            path: (0, node_path_1.resolve)(ROOT, "packages/hook/src"),
            description: "Claude Code PostToolUse hook handler",
            entryPoint: "index.ts",
            exports: [
                { name: "handlePostToolUse", kind: "function", signature: "(event: ToolUseEvent) => Promise<void>" },
            ],
            dependencies: [
                { module: "core", imports: ["parseUnifiedDiff", "annotateChanges"] },
                { module: "history", imports: ["HistoryStore"] },
            ],
        },
        daemon: {
            path: (0, node_path_1.resolve)(ROOT, "packages/daemon/src"),
            description: "Background watcher process",
            entryPoint: "index.ts",
            exports: [
                { name: "startDaemon", kind: "function", signature: "(config: DaemonConfig) => Promise<void>" },
            ],
            dependencies: [
                { module: "hook", imports: ["handlePostToolUse"] },
            ],
        },
    },
    tests: {
        dir: (0, node_path_1.resolve)(ROOT, ".devcompanion/tests"),
        naming: "test_<module>_<functionName>.test.ts",
        framework: "vitest",
        importPrefix: "../../packages",
    },
    reports: {
        dataFile: (0, node_path_1.resolve)(ROOT, ".devcompanion/report-data.json"),
        htmlFile: (0, node_path_1.resolve)(ROOT, "onboard-report.html"),
        collectScript: (0, node_path_1.resolve)(ROOT, "scripts/collect-report-data.ts"),
        renderScript: (0, node_path_1.resolve)(ROOT, "scripts/generate-report.ts"),
    },
    tracking: {
        indexFile: (0, node_path_1.resolve)(ROOT, ".devcompanion/index.json"),
        historyDir: (0, node_path_1.resolve)(ROOT, ".devcompanion/history"),
        eclDir: (0, node_path_1.resolve)(ROOT, "docs/ecl"),
    },
    ignoredDirs: [
        "node_modules", ".git", ".devcompanion", "dist", "build",
        "__pycache__", ".venv", "coverage", ".next",
    ],
};
exports.default = config;
//# sourceMappingURL=devcompanion.config.js.map