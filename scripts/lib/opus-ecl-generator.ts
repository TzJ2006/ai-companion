import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { FunctionAnalysis } from "@aidev/types";
import { callClaude } from "./claude-caller.ts";
import { stripMarkdownFences } from "../../packages/core/src/utils.ts";
import type { ProjectMetadata } from "./project-context-generator.ts";

export interface OpusEclResult {
  overview_summary: string;
  architecture: string;
  features: OpusFeature[];
  tech_stack: string[];
}

export interface OpusFeature {
  name: string;
  description: string;
  purpose: string;
  approach: string;
  key_files: string[];
  constraints: string[];
  function_names: string[];
}

export async function generateOpusProjectUnderstanding(
  metadata: ProjectMetadata,
  projectPath: string,
  options: { timeout?: number } = {}
): Promise<string> {
  const timeout = options.timeout ?? 120000;

  const documents = collectProjectDocuments(projectPath);
  const directoryTree = buildDirectoryTreeString(projectPath);

  const prompt = buildProjectUnderstandingPrompt(metadata, directoryTree, documents);

  const result = await callClaude(prompt, { model: "opus", timeout });
  return result;
}

export async function generateOpusEcl(
  metadata: ProjectMetadata,
  projectPath: string,
  projectUnderstanding: string,
  functionAnalyses: FunctionAnalysis[],
  options: { timeout?: number } = {}
): Promise<OpusEclResult> {
  const timeout = options.timeout ?? 180000;

  const prompt = buildEclGenerationPrompt(
    metadata, projectUnderstanding, functionAnalyses
  );

  const result = await callClaude(prompt, { model: "opus", timeout });
  return parseOpusEclResponse(result);
}

export function writeOpusEcl(
  projectPath: string,
  projectName: string,
  eclResult: OpusEclResult
): string {
  const eclDirectory = join(projectPath, "docs", "ecl");
  mkdirSync(eclDirectory, { recursive: true });

  const eclFilePath = join(eclDirectory, `${projectName}-features.yaml`);
  const yamlContent = formatEclAsYaml(projectName, eclResult);
  writeFileSync(eclFilePath, yamlContent, "utf-8");
  return eclFilePath;
}

function collectProjectDocuments(projectPath: string): Map<string, string> {
  const documents = new Map<string, string>();

  const docFiles = [
    "README.md",
    "OVERVIEW.md",
    "docs/OVERVIEW.md",
    "CLAUDE.md",
    "ARCHITECTURE.md",
    "docs/ARCHITECTURE.md",
    "CONTRIBUTING.md",
  ];

  for (const docFile of docFiles) {
    const fullPath = join(projectPath, docFile);
    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, "utf-8");
        documents.set(docFile, content.slice(0, 5000));
      } catch { /* ignore */ }
    }
  }

  const docsDir = join(projectPath, "docs");
  if (existsSync(docsDir)) {
    try {
      const entries = readdirSync(docsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".md") && !documents.has(`docs/${entry.name}`)) {
          const content = readFileSync(join(docsDir, entry.name), "utf-8");
          documents.set(`docs/${entry.name}`, content.slice(0, 3000));
        }
      }
    } catch { /* ignore */ }
  }

  return documents;
}

function buildDirectoryTreeString(projectPath: string): string {
  const lines: string[] = [];
  const IGNORED = new Set([
    "node_modules", "__pycache__", ".git", ".devcompanion", "dist", "build",
    "out", ".next", ".venv", "venv", "coverage", ".cache", "archive",
    ".mypy_cache", ".pytest_cache", ".ruff_cache", "egg-info",
  ]);

  function walk(dir: string, prefix: string, depth: number): void {
    if (depth > 4) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch { return; }

    const filtered = entries.filter((e) => {
      if (e.name.startsWith(".") && e.isDirectory()) return false;
      if (IGNORED.has(e.name)) return false;
      if (e.name.endsWith(".pyc") || e.name.endsWith(".pyo")) return false;
      return true;
    });

    const dirs = filtered.filter((e) => e.isDirectory());
    const files = filtered.filter((e) => e.isFile());

    for (const file of files) {
      lines.push(`${prefix}${file.name}`);
    }
    for (const d of dirs) {
      lines.push(`${prefix}${d.name}/`);
      walk(join(dir, d.name), prefix + "  ", depth + 1);
    }
  }

  walk(projectPath, "", 0);
  return lines.slice(0, 300).join("\n");
}

function buildProjectUnderstandingPrompt(
  metadata: ProjectMetadata,
  directoryTree: string,
  documents: Map<string, string>
): string {
  const sections: string[] = [];

  sections.push("You are analyzing a software project to understand its architecture and feature boundaries.");
  sections.push("Your goal: produce a detailed project understanding that will later be used to generate an Evolving Constraint Language (ECL) document.");
  sections.push("");
  sections.push(`## Project: ${metadata.project_name}`);
  if (metadata.description) {
    sections.push(`Description: ${metadata.description}`);
  }
  sections.push(`Language: ${metadata.language}`);
  sections.push("");

  sections.push("## Directory Structure");
  sections.push("```");
  sections.push(directoryTree);
  sections.push("```");
  sections.push("");

  if (documents.size > 0) {
    sections.push("## Project Documentation");
    for (const [path, content] of documents.entries()) {
      sections.push(`### ${path}`);
      sections.push(content);
      sections.push("");
    }
  }

  sections.push("## Task");
  sections.push("Analyze the directory structure and documentation above. Provide a comprehensive project understanding including:");
  sections.push("1. What this project does (2-3 sentences)");
  sections.push("2. The high-level architecture (how modules/packages relate)");
  sections.push("3. Identify distinct FEATURE AREAS — each feature is a cohesive functional boundary (not just a directory). A feature groups related functionality that serves one purpose.");
  sections.push("4. For each feature: name, purpose, which directories/files it spans");
  sections.push("5. Technology stack");
  sections.push("");
  sections.push("Write your analysis as structured prose. Be specific and use the actual directory/file names.");

  return sections.join("\n");
}

function buildEclGenerationPrompt(
  metadata: ProjectMetadata,
  projectUnderstanding: string,
  functionAnalyses: FunctionAnalysis[]
): string {
  const sections: string[] = [];

  sections.push("You previously analyzed a project. Now generate an Evolving Constraint Language (ECL) document based on your understanding AND the function-level analysis below.");
  sections.push("");
  sections.push("## Your Prior Analysis");
  sections.push(projectUnderstanding.slice(0, 8000));
  sections.push("");

  sections.push("## Function Analysis Results");
  sections.push(`Total functions analyzed: ${functionAnalyses.length}`);
  sections.push("");

  const byDir = new Map<string, FunctionAnalysis[]>();
  for (const fa of functionAnalyses) {
    const dir = fa.file_path.split(/[/\\]/).slice(0, 2).join("/");
    const existing = byDir.get(dir) ?? [];
    existing.push(fa);
    byDir.set(dir, existing);
  }

  for (const [dir, funcs] of byDir.entries()) {
    sections.push(`### ${dir} (${funcs.length} functions)`);
    for (const f of funcs.slice(0, 15)) {
      sections.push(`- ${f.function_name}: ${f.what}`);
    }
    if (funcs.length > 15) {
      sections.push(`  ... and ${funcs.length - 15} more`);
    }
    sections.push("");
  }

  sections.push("## Required Output");
  sections.push("Return ONLY valid JSON (no markdown fences) matching this schema:");
  sections.push(`{
  "overview_summary": "<3-5 sentences: what this project does, for whom, and why>",
  "architecture": "<2-3 sentences: architectural pattern and key design decisions>",
  "features": [
    {
      "name": "<short feature name>",
      "description": "<1-2 sentences describing the feature>",
      "purpose": "<why this feature exists>",
      "approach": "<how it's implemented>",
      "key_files": ["<relative file paths>"],
      "constraints": ["<important invariant or rule>"],
      "function_names": ["<names of key functions in this feature>"]
    }
  ],
  "tech_stack": ["<technology>"]
}`);
  sections.push("");
  sections.push("Guidelines:");
  sections.push("- Create 3-15 features depending on project size");
  sections.push("- Each feature should be a FUNCTIONAL boundary, not just a directory");
  sections.push("- A function belongs to the feature it most directly serves");
  sections.push("- key_files: list the most important 3-5 files per feature");
  sections.push("- function_names: list the 3-10 most important functions per feature");
  sections.push("- constraints: real invariants that should hold (not generic statements)");

  return sections.join("\n");
}

function parseOpusEclResponse(raw: string): OpusEclResult {
  const cleaned = stripMarkdownFences(raw);
  return JSON.parse(cleaned) as OpusEclResult;
}

function formatEclAsYaml(projectName: string, ecl: OpusEclResult): string {
  let yaml = `# Evolving Constraint Language document for ${projectName}\n`;
  yaml += `# Generated via Opus semantic analysis: ${new Date().toISOString()}\n`;
  yaml += `# Three-stage pipeline: Opus understanding → Haiku function analysis → Opus ECL synthesis\n\n`;
  yaml += `# Overview: ${ecl.overview_summary}\n`;
  yaml += `# Architecture: ${ecl.architecture}\n`;
  yaml += `# Tech stack: ${ecl.tech_stack.join(", ")}\n\n`;
  yaml += `features:\n`;

  for (const feature of ecl.features) {
    yaml += `\n  - feature: "${escapeYaml(feature.name)}"\n`;
    yaml += `    description: "${escapeYaml(feature.description)}"\n`;
    yaml += `    purpose: "${escapeYaml(feature.purpose)}"\n`;
    yaml += `    implementation:\n`;
    yaml += `      approach: "${escapeYaml(feature.approach)}"\n`;
    yaml += `      key_files:\n`;
    for (const file of feature.key_files) {
      yaml += `        - "${file.replace(/\\/g, "/")}"\n`;
    }
    yaml += `      constraints:\n`;
    for (const constraint of feature.constraints) {
      yaml += `        - "${escapeYaml(constraint)}"\n`;
    }
    yaml += `    verification:\n`;
    yaml += `      - name: "${feature.name} key files exist"\n`;
    yaml += `        command: "test -f ${feature.key_files[0]?.replace(/\\/g, "/") ?? "."}"\n`;
    yaml += `        expect: "file exists"\n`;
    yaml += `    function_names:\n`;
    for (const fn of feature.function_names) {
      yaml += `      - "${fn}"\n`;
    }
  }

  return yaml;
}

function escapeYaml(text: string): string {
  return text.replace(/"/g, '\\"').replace(/\n/g, " ");
}
