import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { callClaude } from "../../packages/llm/src/index.ts";
import { stripMarkdownFences } from "../../packages/core/src/utils.ts";


export interface ProjectMetadata {
  project_name: string;
  description: string | null;
  language: string;
  framework_hints: string[];
  entry_files: string[];
  config_files: string[];
  file_tree_summary: string;
  package_structure: PackageInfo[];
}

export interface PackageInfo {
  name: string;
  path: string;
  description: string | null;
  entry_file: string | null;
  source_files_count: number;
}

export interface ProjectContext {
  summary: string;
  architecture_overview: string;
  module_responsibilities: Record<string, string>;
  tech_stack: string[];
  generated_at: string;
}

const MAX_TREE_FILES = 150;

const CONFIG_FILE_NAMES = new Set([
  "package.json",
  "tsconfig.json",
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
  "Makefile",
  "docker-compose.yml",
  "Dockerfile",
  ".env.example",
]);

const ENTRY_FILE_NAMES = new Set([
  "index.ts",
  "index.tsx",
  "main.ts",
  "main.py",
  "app.ts",
  "app.py",
  "server.ts",
  "server.py",
  "cli.ts",
  "__main__.py",
]);

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  "__pycache__",
  ".git",
  ".devcompanion",
  "dist",
  "build",
  "out",
  ".next",
  ".venv",
  "venv",
  "coverage",
  ".cache",
  "archive",
]);

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mts", ".cts",
  ".py", ".pyi",
  ".go", ".rs", ".java", ".kt",
]);

export function collectProjectMetadata(projectPath: string): ProjectMetadata {
  const projectName = basename(projectPath);
  const description = readProjectDescription(projectPath);
  const language = detectPrimaryLanguage(projectPath);
  const frameworkHints = detectFrameworkHints(projectPath);
  const fileTree = buildFileTree(projectPath);
  const entryFiles = fileTree.filter((filePath) => ENTRY_FILE_NAMES.has(basename(filePath)));
  const configFiles = fileTree.filter((filePath) => CONFIG_FILE_NAMES.has(basename(filePath)));
  const packageStructure = detectPackageStructure(projectPath);

  const prioritizedFiles = prioritizeFiles(fileTree, entryFiles, configFiles);
  const truncatedTree = prioritizedFiles.slice(0, MAX_TREE_FILES);
  const fileTreeSummary = truncatedTree.map((filePath) => relative(projectPath, filePath)).join("\n");

  return {
    project_name: projectName,
    description,
    language,
    framework_hints: frameworkHints,
    entry_files: entryFiles.map((filePath) => relative(projectPath, filePath)),
    config_files: configFiles.map((filePath) => relative(projectPath, filePath)),
    file_tree_summary: fileTreeSummary,
    package_structure: packageStructure,
  };
}

export async function generateProjectContext(
  metadata: ProjectMetadata,
  options: { model?: string; timeout?: number } = {}
): Promise<ProjectContext> {
  const model = options.model ?? "haiku";
  const timeout = options.timeout ?? 60000;

  const prompt = buildContextPrompt(metadata);

  try {
    const { output: stdout } = await callClaude(prompt, { model, timeout, maxOutputBytes: 0 });

    return parseContextResponse(stdout, metadata);
  } catch {
    return buildFallbackContext(metadata);
  }
}

export function formatContextForPrompt(context: ProjectContext): string {
  const sections: string[] = [];
  sections.push(`## Project Context`);
  sections.push(context.summary);
  sections.push("");
  sections.push(`**Architecture:** ${context.architecture_overview}`);
  sections.push("");

  if (context.tech_stack.length > 0) {
    sections.push(`**Tech Stack:** ${context.tech_stack.join(", ")}`);
    sections.push("");
  }

  const moduleEntries = Object.entries(context.module_responsibilities);
  if (moduleEntries.length > 0) {
    sections.push("**Modules:**");
    for (const [moduleName, responsibility] of moduleEntries) {
      sections.push(`- ${moduleName}: ${responsibility}`);
    }
  }

  return sections.join("\n");
}

function buildContextPrompt(metadata: ProjectMetadata): string {
  const sections: string[] = [];

  sections.push("Analyze this project and return a JSON object describing its architecture.");
  sections.push("Be concise: each field should be specific and direct.");
  sections.push("");

  sections.push(`## Project: ${metadata.project_name}`);
  if (metadata.description) {
    sections.push(`Description: ${metadata.description}`);
  }
  sections.push(`Primary language: ${metadata.language}`);
  if (metadata.framework_hints.length > 0) {
    sections.push(`Frameworks: ${metadata.framework_hints.join(", ")}`);
  }
  sections.push("");

  if (metadata.package_structure.length > 0) {
    sections.push("## Package Structure");
    for (const pkg of metadata.package_structure) {
      sections.push(`- ${pkg.name} (${pkg.source_files_count} files)${pkg.description ? ": " + pkg.description : ""}`);
    }
    sections.push("");
  }

  sections.push("## File Tree (key files)");
  sections.push("```");
  sections.push(metadata.file_tree_summary);
  sections.push("```");
  sections.push("");

  sections.push("## Required Output");
  sections.push("Return ONLY valid JSON (no markdown fences, no explanation) matching this schema:");
  sections.push(`{
  "summary": "<string: 2-3 sentences describing what this project does and its purpose>",
  "architecture_overview": "<string: 1-2 sentences on the high-level architecture pattern>",
  "module_responsibilities": {
    "<module_name>": "<string: 1 sentence describing this module's role>"
  },
  "tech_stack": ["<string: key technology/framework used>"]
}`);

  return sections.join("\n");
}

function parseContextResponse(raw: string, metadata: ProjectMetadata): ProjectContext {
  const cleaned = stripMarkdownFences(raw);
  const parsed = JSON.parse(cleaned) as Omit<ProjectContext, "generated_at">;

  return {
    ...parsed,
    generated_at: new Date().toISOString(),
  };
}

function buildFallbackContext(metadata: ProjectMetadata): ProjectContext {
  const moduleResponsibilities: Record<string, string> = {};
  for (const pkg of metadata.package_structure) {
    moduleResponsibilities[pkg.name] = pkg.description ?? `${pkg.name} module`;
  }

  return {
    summary: metadata.description ?? `${metadata.project_name} — a ${metadata.language} project`,
    architecture_overview: metadata.package_structure.length > 1
      ? "Multi-package monorepo structure"
      : "Single-package project",
    module_responsibilities: moduleResponsibilities,
    tech_stack: metadata.framework_hints,
    generated_at: new Date().toISOString(),
  };
}

function readProjectDescription(projectPath: string): string | null {
  const packageJsonPath = join(projectPath, "package.json");
  if (existsSync(packageJsonPath)) {
    try {
      const content = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
      if (content.description) return content.description;
    } catch { /* ignore */ }
  }

  const pyprojectPath = join(projectPath, "pyproject.toml");
  if (existsSync(pyprojectPath)) {
    try {
      const content = readFileSync(pyprojectPath, "utf-8");
      const match = content.match(/description\s*=\s*"([^"]+)"/);
      if (match) return match[1];
    } catch { /* ignore */ }
  }

  const readmePath = join(projectPath, "README.md");
  if (existsSync(readmePath)) {
    try {
      const content = readFileSync(readmePath, "utf-8");
      const lines = content.split("\n").filter((line) => line.trim() && !line.startsWith("#"));
      if (lines.length > 0) return lines[0].slice(0, 200);
    } catch { /* ignore */ }
  }

  return null;
}

function detectPrimaryLanguage(projectPath: string): string {
  const hasPackageJson = existsSync(join(projectPath, "package.json"));
  const hasTsConfig = existsSync(join(projectPath, "tsconfig.json"));
  const hasPyproject = existsSync(join(projectPath, "pyproject.toml"));
  const hasSetupPy = existsSync(join(projectPath, "setup.py"));
  const hasGoMod = existsSync(join(projectPath, "go.mod"));
  const hasCargoToml = existsSync(join(projectPath, "Cargo.toml"));

  if (hasTsConfig || hasPackageJson) {
    if (hasPyproject || hasSetupPy) return "mixed (TypeScript + Python)";
    return "TypeScript";
  }
  if (hasPyproject || hasSetupPy) return "Python";
  if (hasGoMod) return "Go";
  if (hasCargoToml) return "Rust";
  return "unknown";
}

function detectFrameworkHints(projectPath: string): string[] {
  const hints: string[] = [];
  const packageJsonPath = join(projectPath, "package.json");

  if (existsSync(packageJsonPath)) {
    try {
      const content = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
      const allDeps = { ...content.dependencies, ...content.devDependencies };
      if (allDeps["next"]) hints.push("Next.js");
      if (allDeps["react"]) hints.push("React");
      if (allDeps["express"]) hints.push("Express");
      if (allDeps["fastify"]) hints.push("Fastify");
      if (allDeps["vitest"]) hints.push("Vitest");
      if (allDeps["jest"]) hints.push("Jest");
      if (allDeps["prisma"]) hints.push("Prisma");
      if (allDeps["tree-sitter"]) hints.push("Tree-sitter");
    } catch { /* ignore */ }
  }

  return hints;
}

function buildFileTree(projectPath: string): string[] {
  const files: string[] = [];
  walkDirectory(projectPath, files, 0, 5);
  return files;
}

function walkDirectory(directory: string, results: string[], depth: number, maxDepth: number): void {
  if (depth > maxDepth) return;

  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.isDirectory()) continue;
    if (IGNORED_DIRECTORIES.has(entry.name)) continue;

    const fullPath = join(directory, entry.name);

    if (entry.isFile()) {
      const ext = "." + (entry.name.split(".").pop() ?? "");
      if (CODE_EXTENSIONS.has(ext) || CONFIG_FILE_NAMES.has(entry.name)) {
        results.push(fullPath);
      }
    } else if (entry.isDirectory()) {
      walkDirectory(fullPath, results, depth + 1, maxDepth);
    }
  }
}

function prioritizeFiles(
  allFiles: string[],
  entryFiles: string[],
  configFiles: string[]
): string[] {
  const entrySet = new Set(entryFiles);
  const configSet = new Set(configFiles);

  const priority1 = allFiles.filter((filePath) => configSet.has(filePath));
  const priority2 = allFiles.filter((filePath) => entrySet.has(filePath));
  const priority3 = allFiles.filter((filePath) => !configSet.has(filePath) && !entrySet.has(filePath));

  return [...priority1, ...priority2, ...priority3];
}

function detectPackageStructure(projectPath: string): PackageInfo[] {
  const packages: PackageInfo[] = [];

  const packagesDir = join(projectPath, "packages");
  if (existsSync(packagesDir)) {
    try {
      const entries = readdirSync(packagesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const pkgPath = join(packagesDir, entry.name);
        const pkgJsonPath = join(pkgPath, "package.json");
        let description: string | null = null;
        let entryFile: string | null = null;

        if (existsSync(pkgJsonPath)) {
          try {
            const content = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
            description = content.description ?? null;
            entryFile = content.main ?? content.exports?.["."] ?? null;
          } catch { /* ignore */ }
        }

        const sourceCount = countSourceFiles(pkgPath);
        packages.push({
          name: entry.name,
          path: relative(projectPath, pkgPath),
          description,
          entry_file: entryFile,
          source_files_count: sourceCount,
        });
      }
    } catch { /* ignore */ }
  }

  return packages;
}

function countSourceFiles(directory: string): number {
  let count = 0;
  const files: string[] = [];
  walkDirectory(directory, files, 0, 4);
  for (const filePath of files) {
    const ext = "." + (filePath.split(".").pop() ?? "");
    if (CODE_EXTENSIONS.has(ext)) count++;
  }
  return count;
}
