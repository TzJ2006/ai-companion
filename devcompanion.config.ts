import { resolve } from "node:path";

const ROOT = import.meta.dirname;

export interface ModuleExport {
  name: string;
  kind: "function" | "type" | "interface" | "class" | "const";
  signature?: string;
}

export interface ModuleDependency {
  module: string;
  imports: string[];
}

export interface ModuleSlot {
  path: string;
  description: string;
  entryPoint: string;
  exports: ModuleExport[];
  dependencies: ModuleDependency[];
}

export interface DevCompanionConfig {
  projectRoot: string;

  modules: Record<string, ModuleSlot>;

  tests: {
    dir: string;
    naming: string;
    framework: "vitest";
    importPrefix: string;
  };

  reports: {
    dataFile: string;
    htmlFile: string;
    collectScript: string;
    renderScript: string;
  };

  tracking: {
    indexFile: string;
    historyDir: string;
    eclDir: string;
  };

  ignoredDirs: string[];
}

const config: DevCompanionConfig = {
  projectRoot: ROOT,

  modules: {
    ast: {
      path: resolve(ROOT, "packages/ast/src"),
      description: "AST parsing, identity hashing, multi-lang support",
      entryPoint: "index.ts",
      exports: [
        { name: "parseFile", kind: "function", signature: "(filePath: string) => Promise<ParsedModule>" },
        { name: "parseFileAuto", kind: "function", signature: "(filePath: string) => Promise<ParsedModule>" },
        { name: "computeFunctionIdentity", kind: "function", signature: "(filePath: string, fn: FunctionSignature) => FunctionIdentity" },
        { name: "getSupportedExtensions", kind: "function", signature: "() => string[]" },
        { name: "analyzeFileCalls", kind: "function", signature: "(filePath: string) => Promise<CallGraphEntry[]>" },
        { name: "buildCallGraph", kind: "function", signature: "(entries: CallGraphEntry[]) => CallGraph" },
        { name: "formatFunctionId", kind: "function", signature: "(filePath: string, functionName: string) => string" },
        { name: "ParsedModule", kind: "type" },
        { name: "FunctionSignature", kind: "type" },
        { name: "FunctionIdentity", kind: "type" },
        { name: "CallGraphEntry", kind: "type" },
        { name: "CallGraph", kind: "type" },
      ],
      dependencies: [],
    },
    types: {
      path: resolve(ROOT, "packages/types/src"),
      description: "Shared interfaces used across packages (history, analysis, modularity)",
      entryPoint: "index.ts",
      exports: [
        { name: "ChangeRecord", kind: "type" },
        { name: "ReviewSession", kind: "type" },
        { name: "FunctionAnalysis", kind: "type" },
        { name: "FunctionModularity", kind: "type" },
      ],
      dependencies: [],
    },
    core: {
      path: resolve(ROOT, "packages/core/src"),
      description: "Business logic: diff parsing, annotation, test generation",
      entryPoint: "index.ts",
      exports: [
        { name: "parseUnifiedDiff", kind: "function", signature: "(raw: string) => FileDiff[]" },
        { name: "annotateChanges", kind: "function", signature: "(diffs: FileDiff[], functionMap: Map, ctx: AnnotationContext) => AnnotatedChange[]" },
        { name: "toChangeRecords", kind: "function", signature: "(annotations: AnnotatedChange[], sessionId: string, eclContext?: EclContext) => ChangeRecord[]" },
        { name: "generateTestSkeleton", kind: "function", signature: "(mod: ParsedModule, config: TsTestGenConfig) => GeneratedTsTest[]" },
        { name: "analyzeBatch", kind: "function", signature: "(inputs: AnalysisInput[], options?: Partial<AnalyzerOptions>) => Promise<FunctionAnalysis[]>" },
        { name: "analyzeModularityBatch", kind: "function", signature: "(inputs: ModularityInput[], options?: Partial<ModularityAnalyzerOptions>) => Promise<FunctionModularity[]>" },
        { name: "FileDiff", kind: "type" },
        { name: "AnnotatedChange", kind: "type" },
      ],
      dependencies: [
        { module: "ast", imports: ["ParsedModule", "FunctionSignature", "computeFunctionIdentity"] },
      ],
    },
    render: {
      path: resolve(ROOT, "packages/render/src"),
      description: "HTML report rendering (session view, onboard view)",
      entryPoint: "index.ts",
      exports: [
        { name: "renderOnboardHtml", kind: "function", signature: "(index: ProjectIndex, options: OnboardRenderOptions) => string" },
        { name: "renderSessionToHtml", kind: "function", signature: "(session: ReviewSession, options?: RenderOptions) => string" },
        { name: "ReportData", kind: "type" },
        { name: "OnboardRenderOptions", kind: "type" },
      ],
      dependencies: [
        { module: "history", imports: ["ProjectIndex"] },
        { module: "ast", imports: ["ParsedModule"] },
      ],
    },
    history: {
      path: resolve(ROOT, "packages/history/src"),
      description: "Change history storage and indexing",
      entryPoint: "index.ts",
      exports: [
        { name: "HistoryStore", kind: "class" },
        { name: "AnalysisStore", kind: "class" },
        { name: "ModularityStore", kind: "class" },
        { name: "projectSession", kind: "function" },
        { name: "applyManagedGitignore", kind: "function" },
        { name: "visibilityToGitignoreProfile", kind: "function" },
        { name: "ProjectIndex", kind: "type" },
        { name: "FunctionIndexEntry", kind: "type" },
        { name: "RepoVisibility", kind: "type" },
      ],
      dependencies: [],
    },
    cli: {
      path: resolve(ROOT, "packages/cli/src"),
      description: "CLI `aidev` — 8 commands: init, review, render, history, onboard, analyze, idea, install",
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
      path: resolve(ROOT, "packages/hook/src"),
      description: "Claude Code + Codex PostToolUse capture and PreToolUse guard handlers",
      entryPoint: "index.ts",
      exports: [
        { name: "handlePostToolUse", kind: "function", signature: "(stdin: string, supportedExtensions?: Set<string>) => void" },
        { name: "handlePreToolUse", kind: "function", signature: "(event: PreToolUseEvent, projectRoot?: string) => PreToolUseResult" },
        { name: "spawnQueueWorker", kind: "function", signature: "(projectRoot: string) => void" },
      ],
      dependencies: [
        { module: "core", imports: ["parseUnifiedDiff", "annotateChanges"] },
        { module: "history", imports: ["HistoryStore"] },
      ],
    },
    daemon: {
      path: resolve(ROOT, "packages/daemon/src"),
      description: "Queue processor — long-running daemon plus the hook-spawned short-lived worker (worker.ts)",
      entryPoint: "index.ts",
      exports: [
        { name: "startDaemon", kind: "function", signature: "(projectRoot: string) => Promise<void>" },
      ],
      dependencies: [
        { module: "hook", imports: ["handlePostToolUse"] },
      ],
    },
    llm: {
      path: resolve(ROOT, "packages/llm/src"),
      description: "Claude LLM calling utility (preflight, timeout, abort)",
      entryPoint: "index.ts",
      exports: [
        { name: "callClaude", kind: "function", signature: "(prompt: string, options?: ClaudeCallOptions) => Promise<ClaudeCallResult>" },
        { name: "preflight", kind: "function", signature: "() => Promise<PreflightResult>" },
        { name: "ClaudeNotAvailableError", kind: "class" },
        { name: "ClaudeTimeoutError", kind: "class" },
      ],
      dependencies: [],
    },
    exec: {
      path: resolve(ROOT, "packages/exec/src"),
      description: "DAG execution engine: topo-sort, subagent context, status management",
      entryPoint: "index.ts",
      exports: [
        { name: "parseEclDag", kind: "function", signature: "(eclPath: string) => Promise<DagGraph>" },
        { name: "topologicalSort", kind: "function", signature: "(graph: DagGraph) => ExecutionLayer[]" },
        { name: "getReadyNodes", kind: "function", signature: "(graph: DagGraph) => FnNode[]" },
        { name: "getExecutionState", kind: "function", signature: "(graph: DagGraph) => ExecutionState" },
        { name: "buildSubagentContext", kind: "function", signature: "(fnId: string, graph: DagGraph, eclPath: string) => Promise<SubagentContext>" },
        { name: "formatSubagentPrompt", kind: "function", signature: "(context: SubagentContext) => string" },
        { name: "updateFnStatus", kind: "function", signature: "(eclPath: string, fnId: string, status: FnStatus) => Promise<void>" },
        { name: "runVerification", kind: "function", signature: "(config: FnVerify, timeout?: number) => Promise<VerificationResult>" },
        { name: "loadExecConfig", kind: "function", signature: "(projectRoot?: string) => Promise<ExecConfig>" },
      ],
      dependencies: [],
    },
    idea: {
      path: resolve(ROOT, "packages/idea/src"),
      description: "Idea backlog storage and research engine",
      entryPoint: "index.ts",
      exports: [
        { name: "IdeaStore", kind: "class" },
        { name: "executeResearch", kind: "function", signature: "(store: IdeaStore, slug: string, options?: ResearchOptions) => Promise<{reportPath, validation}>" },
        { name: "validateResearchReport", kind: "function", signature: "(markdown: string) => ValidationResult" },
        { name: "generateSlug", kind: "function", signature: "(title: string) => string" },
        { name: "IdeaEntry", kind: "type" },
        { name: "ValidationResult", kind: "type" },
      ],
      dependencies: [
        { module: "llm", imports: ["callClaude"] },
      ],
    },
    dashboard: {
      path: resolve(ROOT, "packages/dashboard/src"),
      description: "Fastify web UI that scans projects and serves reports",
      entryPoint: "cli.ts",
      exports: [],
      dependencies: [],
    },
  },

  tests: {
    dir: resolve(ROOT, ".devcompanion/tests"),
    naming: "test_<module>_<functionName>.test.ts",
    framework: "vitest",
    importPrefix: "../../packages",
  },

  reports: {
    dataFile: resolve(ROOT, ".devcompanion/report-data.json"),
    htmlFile: resolve(ROOT, ".devcompanion/reports/onboard-report.html"),
    collectScript: resolve(ROOT, "scripts/collect-report-data.ts"),
    renderScript: resolve(ROOT, "scripts/generate-report.ts"),
  },

  tracking: {
    indexFile: resolve(ROOT, ".devcompanion/index.json"),
    historyDir: resolve(ROOT, ".devcompanion/history"),
    eclDir: resolve(ROOT, "docs/ecl"),
  },

  ignoredDirs: [
    "node_modules", ".git", ".devcompanion", "dist", "build",
    "__pycache__", ".venv", "coverage", ".next",
  ],
};

export default config;
