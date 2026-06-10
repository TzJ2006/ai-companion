import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { execSync } from "node:child_process";
import type { AnalysisInput, FunctionAnalysis } from "@aidev/types";
import { parseFileAuto, getSupportedExtensions, analyzeFileCalls } from "@aidev/ast";
import {
  collectProjectMetadata,
  generateProjectContext,
  type ProjectContext,
  type ProjectMetadata,
} from "./project-context-generator.ts";
import { analyzeAllFunctions } from "./enhanced-analyzer.ts";
import {
  aggregateFunctionsByDirectory,
  generateFeatureDescription,
  generateVerificationCommands,
  writeSemanticEcl,
  type EnhancedFeature,
} from "./semantic-ecl-inferrer.ts";
import {
  generateFunctionTestSkeleton,
  generateFeatureTestSkeleton,
  writeTestFiles,
  type TestSkeleton,
  type TestGenerationResult,
} from "./test-skeleton-generator.ts";
import { detectProject } from "./project-detector.ts";
import {
  generateOpusProjectUnderstanding,
  generateOpusEcl,
  writeOpusEcl,
} from "./opus-ecl-generator.ts";

export interface OnboardingOptions {
  model?: string;
  concurrency?: number;
  timeout?: number;
  skipTests?: boolean;
  skipEcl?: boolean;
  forceReanalyze?: boolean;
  onProgress?: (stage: string, done: number, total: number, detail: string) => void;
}

export interface OnboardingResult {
  project_name: string;
  language: string;
  functions_analyzed: number;
  features_inferred: number;
  tests_generated: TestGenerationResult | null;
  ecl_path: string | null;
  analysis_cache_path: string;
  duration_ms: number;
}

interface CachedAnalysis {
  git_commit: string;
  generated_at: string;
  project_context: ProjectContext;
  functions: FunctionAnalysis[];
}

export async function runOnboardingAnalysis(
  projectPath: string,
  options: OnboardingOptions = {}
): Promise<OnboardingResult> {
  const startTime = Date.now();
  const progress = options.onProgress ?? (() => {});

  const detection = detectProject(projectPath);
  if (!detection.has_code) {
    throw new Error(`Project at ${projectPath} has no analyzable code`);
  }

  const cachePath = join(projectPath, ".devcompanion", "analysis.json");
  const cached = options.forceReanalyze ? null : loadCachedAnalysis(cachePath, projectPath);

  let projectContext: ProjectContext;
  let analyses: FunctionAnalysis[];

  if (cached) {
    progress("cache", 1, 1, "Using cached analysis");
    projectContext = cached.project_context;
    analyses = cached.functions;
  } else {
    progress("metadata", 0, 1, "Collecting project metadata");
    const metadata = collectProjectMetadata(projectPath);
    progress("metadata", 1, 1, metadata.project_name);

    progress("context", 0, 1, "Generating project context via LLM");
    projectContext = await generateProjectContext(metadata, {
      model: options.model,
      timeout: options.timeout ?? 60000,
    });
    progress("context", 1, 1, "Project context generated");

    progress("parsing", 0, 1, "Parsing source files");
    const inputs = await collectAnalysisInputs(projectPath);
    progress("parsing", 1, 1, `${inputs.length} functions found`);

    progress("analysis", 0, inputs.length, "Analyzing functions with LLM");
    analyses = await analyzeAllFunctions(inputs, projectContext, {
      model: options.model,
      concurrency: options.concurrency,
      timeout: options.timeout,
      onProgress: (done, total, current) => {
        progress("analysis", done, total, current);
      },
    });

    saveCachedAnalysis(cachePath, projectPath, projectContext, analyses);
  }

  let eclPath: string | null = null;
  if (!options.skipEcl) {
    progress("ecl-opus-1", 0, 1, "Opus: Analyzing project structure and documentation");
    const metadata = collectProjectMetadata(projectPath);
    const projectUnderstanding = await generateOpusProjectUnderstanding(
      metadata, projectPath, {}
    );
    progress("ecl-opus-1", 1, 1, "Opus: Project understanding complete");

    progress("ecl-opus-2", 0, 1, "Opus: Generating ECL from function analyses");
    const eclResult = await generateOpusEcl(
      metadata, projectPath, projectUnderstanding, analyses, {}
    );
    progress("ecl-opus-2", 1, 1, `Opus: ${eclResult.features.length} features identified`);

    eclPath = writeOpusEcl(projectPath, metadata.project_name, eclResult);
    progress("ecl", 1, 1, `${eclResult.features.length} features written to ${eclPath}`);
  }

  let testResult: TestGenerationResult | null = null;
  if (!options.skipTests) {
    progress("tests", 0, 1, "Generating test skeletons");
    testResult = generateTestSkeletons(analyses, projectPath, detection.language);
    progress("tests", 1, 1, `${testResult.generated.length} test files generated`);
  }

  const duration = Date.now() - startTime;
  const metadata = collectProjectMetadata(projectPath);

  return {
    project_name: metadata.project_name,
    language: detection.language,
    functions_analyzed: analyses.length,
    features_inferred: eclPath ? countFeaturesInEcl(eclPath) : 0,
    tests_generated: testResult,
    ecl_path: eclPath,
    analysis_cache_path: cachePath,
    duration_ms: duration,
  };
}

export function loadCachedAnalysis(
  cachePath: string,
  projectPath: string
): CachedAnalysis | null {
  if (!existsSync(cachePath)) return null;

  try {
    const content = JSON.parse(readFileSync(cachePath, "utf-8")) as CachedAnalysis;
    const currentCommit = getCurrentGitCommit(projectPath);

    if (content.git_commit !== currentCommit) {
      return null;
    }

    return content;
  } catch {
    return null;
  }
}

export function saveCachedAnalysis(
  cachePath: string,
  projectPath: string,
  projectContext: ProjectContext,
  analyses: FunctionAnalysis[]
): void {
  const cacheDir = join(projectPath, ".devcompanion");
  mkdirSync(cacheDir, { recursive: true });

  const data: CachedAnalysis = {
    git_commit: getCurrentGitCommit(projectPath),
    generated_at: new Date().toISOString(),
    project_context: projectContext,
    functions: analyses,
  };

  writeFileSync(cachePath, JSON.stringify(data, null, 2), "utf-8");
}

async function collectAnalysisInputs(projectPath: string): Promise<AnalysisInput[]> {
  const supportedExtensions = new Set(getSupportedExtensions());
  const sourceFiles = collectSourceFilesRecursive(projectPath, supportedExtensions);
  const inputs: AnalysisInput[] = [];

  for (const file of sourceFiles) {
    try {
      const parsed = await parseFileAuto(file);
      const relPath = relative(projectPath, file);
      const fileContent = readFileSync(file, "utf-8");
      const lines = fileContent.split("\n");

      const imports = parsed.imports.map((imp) => {
        if (imp.is_from) {
          const names = imp.names.join(", ");
          return `from ${imp.module} import ${names}`;
        }
        return `import ${imp.module}`;
      });

      for (const func of parsed.functions) {
        const bodyLines = lines.slice(func.start_line - 1, func.end_line);
        const sourceBody = bodyLines.join("\n");

        const params = func.params.map((p) =>
          `${p.name}${p.type ? ": " + p.type : ""}`
        ).join(", ");
        const signature = `${func.is_async ? "async " : ""}${func.class_name ? func.class_name + "." : ""}${func.name}(${params})${func.return_type ? ": " + func.return_type : ""}`;

        const hash = computeSimpleHash(relPath, func.class_name, func.name, params);

        inputs.push({
          function_hash: hash,
          file_path: relPath,
          function_name: func.name,
          class_name: func.class_name,
          signature,
          source_body: sourceBody,
          imports,
          class_context: func.class_name,
        });
      }

      for (const cls of parsed.classes) {
        for (const method of cls.methods) {
          const bodyLines = lines.slice(method.start_line - 1, method.end_line);
          const sourceBody = bodyLines.join("\n");

          const params = method.params.map((p) =>
            `${p.name}${p.type ? ": " + p.type : ""}`
          ).join(", ");
          const signature = `${method.is_async ? "async " : ""}${cls.name}.${method.name}(${params})${method.return_type ? ": " + method.return_type : ""}`;

          const hash = computeSimpleHash(relPath, cls.name, method.name, params);

          inputs.push({
            function_hash: hash,
            file_path: relPath,
            function_name: method.name,
            class_name: cls.name,
            signature,
            source_body: sourceBody,
            imports,
            class_context: `class ${cls.name}${cls.bases.length > 0 ? " extends " + cls.bases.join(", ") : ""}`,
          });
        }
      }
    } catch {
      // skip unparseable files
    }
  }

  return inputs;
}

async function inferEnhancedFeatures(
  analyses: FunctionAnalysis[],
  projectPath: string,
  projectContext: ProjectContext,
  language: string,
  options: OnboardingOptions
): Promise<EnhancedFeature[]> {
  const groups = aggregateFunctionsByDirectory(analyses, projectPath);
  const features: EnhancedFeature[] = [];

  for (const group of groups) {
    const feature = await generateFeatureDescription(group, projectContext, {
      model: options.model,
      timeout: options.timeout,
    });

    feature.verification = generateVerificationCommands(feature, projectPath, language);
    features.push(feature);
  }

  return features;
}

function generateTestSkeletons(
  analyses: FunctionAnalysis[],
  projectPath: string,
  language: string
): TestGenerationResult {
  const skeletons: TestSkeleton[] = [];

  for (const analysis of analyses) {
    const skeleton = generateFunctionTestSkeleton(analysis, language);
    if (skeleton) {
      skeletons.push(skeleton);
    }
  }

  // Feature-level tests would need the enhanced features; defer to after ECL generation
  // For now just generate function-level tests

  return writeTestFiles(projectPath, skeletons);
}

function collectSourceFilesRecursive(directory: string, extensions: Set<string>): string[] {
  const { readdirSync } = require("node:fs");
  const { join: pathJoin } = require("node:path");
  const results: string[] = [];

  const IGNORED = new Set([
    "node_modules", "__pycache__", ".git", ".devcompanion",
    "dist", "build", "out", ".next", ".venv", "venv", "coverage",
    ".cache", "archive",
  ]);

  function walk(dir: string, depth: number): void {
    if (depth > 6) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch { return; }

    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.isDirectory()) continue;
      if (IGNORED.has(entry.name)) continue;

      const fullPath = pathJoin(dir, entry.name);
      if (entry.isFile()) {
        const ext = "." + (entry.name.split(".").pop() ?? "");
        if (extensions.has(ext)) {
          results.push(fullPath);
        }
      } else if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      }
    }
  }

  walk(directory, 0);
  return results;
}

function getCurrentGitCommit(projectPath: string): string {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: projectPath,
      encoding: "utf-8",
    }).trim();
  } catch {
    return "unknown";
  }
}

function computeSimpleHash(filePath: string, className: string | null, funcName: string, params: string): string {
  const input = `${filePath}:${className ?? ""}:${funcName}:${params}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(16, "0").slice(0, 16);
}

function countFeaturesInEcl(eclPath: string): number {
  try {
    const content = readFileSync(eclPath, "utf-8");
    const matches = content.match(/^- feature:/gm);
    return matches?.length ?? 0;
  } catch {
    return 0;
  }
}
