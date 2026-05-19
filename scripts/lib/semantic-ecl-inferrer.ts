import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative, dirname, basename } from "node:path";
import { callClaude } from "./claude-caller.ts";
import type { FunctionAnalysis } from "@aidev/types";
import { stripMarkdownFences } from "../../packages/core/src/utils.ts";
import type { ProjectContext } from "./project-context-generator.ts";


export interface DirectoryGroup {
  directory: string;
  relative_path: string;
  functions: FunctionAnalysis[];
  combined_purpose: string;
}

export interface EnhancedFeature {
  name: string;
  description: string;
  purpose: string;
  approach: string;
  key_files: string[];
  constraints: string[];
  verification: FeatureVerification[];
  function_count: number;
}

export interface FeatureVerification {
  name: string;
  command: string;
  expect: string;
}

export function aggregateFunctionsByDirectory(
  analyses: FunctionAnalysis[],
  projectPath: string
): DirectoryGroup[] {
  const groups = new Map<string, FunctionAnalysis[]>();

  for (const analysis of analyses) {
    const absolutePath = join(projectPath, analysis.file_path);
    const dir = dirname(absolutePath);
    const relDir = relative(projectPath, dir);
    const topLevelDir = relDir.split(/[/\\]/)[0] || relDir;

    const existing = groups.get(topLevelDir) ?? [];
    existing.push(analysis);
    groups.set(topLevelDir, existing);
  }

  const result: DirectoryGroup[] = [];
  for (const [dirName, functions] of groups.entries()) {
    const whyStatements = functions
      .map((f) => f.why)
      .filter((w) => w && w.length > 0);

    const combinedPurpose = whyStatements.length > 0
      ? summarizePurposes(whyStatements)
      : `${dirName} module functions`;

    result.push({
      directory: dirName,
      relative_path: dirName,
      functions,
      combined_purpose: combinedPurpose,
    });
  }

  return result.sort((a, b) => b.functions.length - a.functions.length);
}

export async function generateFeatureDescription(
  group: DirectoryGroup,
  projectContext: ProjectContext,
  options: { model?: string; timeout?: number } = {}
): Promise<EnhancedFeature> {
  const model = options.model ?? "haiku";
  const timeout = options.timeout ?? 30000;

  const prompt = buildFeaturePrompt(group, projectContext);

  try {
    const stdout = await callClaude(prompt, { model, timeout });

    return parseFeatureResponse(stdout, group);
  } catch {
    return buildFallbackFeature(group);
  }
}

export function generateVerificationCommands(
  feature: EnhancedFeature,
  projectPath: string,
  language: string
): FeatureVerification[] {
  const verifications: FeatureVerification[] = [];

  for (const keyFile of feature.key_files.slice(0, 3)) {
    verifications.push({
      name: `${basename(keyFile)} 文件存在性检查`,
      command: `powershell.exe -NoProfile -Command "Test-Path '${keyFile}'"`,
      expect: "True",
    });
  }

  if (language.includes("TypeScript") || language.includes("typescript")) {
    const hasTypeScriptFiles = feature.key_files.some(
      (f) => f.endsWith(".ts") || f.endsWith(".tsx")
    );
    if (hasTypeScriptFiles) {
      verifications.push({
        name: `${feature.name} 类型检查`,
        command: "npx tsc --noEmit",
        expect: "无类型错误",
      });
    }
  }

  if (language.includes("Python") || language.includes("python")) {
    verifications.push({
      name: `${feature.name} 导入检查`,
      command: `conda run -n base python -c "import ${feature.name.replace(/-/g, "_")}"`,
      expect: "导入成功",
    });
  }

  return verifications;
}

export async function writeSemanticEcl(
  projectPath: string,
  features: EnhancedFeature[],
  projectName: string,
  projectDescription: string | null
): Promise<string> {
  const eclDirectory = join(projectPath, "docs", "ecl");
  mkdirSync(eclDirectory, { recursive: true });

  const eclFilePath = join(eclDirectory, `${projectName}-features.yaml`);

  const yamlContent = generateSemanticEclYaml(projectName, projectDescription, features);
  writeFileSync(eclFilePath, yamlContent, "utf-8");
  return eclFilePath;
}

function generateSemanticEclYaml(
  projectName: string,
  projectDescription: string | null,
  features: EnhancedFeature[]
): string {
  let yaml = `# Evolving Constraint Language document for ${projectName}\n`;
  yaml += `# Generated via semantic analysis: ${new Date().toISOString()}\n`;
  yaml += `# Function-level LLM analysis was used to infer feature descriptions.\n\n`;

  if (projectDescription) {
    yaml += `# Project: ${projectDescription}\n\n`;
  }

  yaml += `features:\n`;

  for (const feature of features) {
    yaml += `\n  - feature: "${feature.name}"\n`;
    yaml += `    description: "${escapeYamlString(feature.description)}"\n`;
    yaml += `    purpose: "${escapeYamlString(feature.purpose)}"\n`;
    yaml += `    implementation:\n`;
    yaml += `      approach: "${escapeYamlString(feature.approach)}"\n`;
    yaml += `      key_files:\n`;
    for (const file of feature.key_files) {
      yaml += `        - "${file.replace(/\\\\/g, "/")}"\n`;
    }
    yaml += `      constraints:\n`;
    for (const constraint of feature.constraints) {
      yaml += `        - "${escapeYamlString(constraint)}"\n`;
    }
    yaml += `    verification:\n`;
    for (const verification of feature.verification) {
      yaml += `      - name: "${escapeYamlString(verification.name)}"\n`;
        yaml += `        command: "${escapeYamlString(verification.command)}"\n`;
        yaml += `        expect: "${escapeYamlString(verification.expect)}"\n`;
    }
    yaml += `    function_count: ${feature.function_count}\n`;
  }

  return yaml;
}

function buildFeaturePrompt(group: DirectoryGroup, context: ProjectContext): string {
  const sections: string[] = [];

  sections.push("Analyze this code module and return a JSON description of it as a feature.");
  sections.push("");
  sections.push(`Project: ${context.summary}`);
  sections.push(`Module directory: ${group.directory}`);
  sections.push(`Functions in this module (${group.functions.length}):`);
  sections.push("");

  const functionSummaries = group.functions.slice(0, 30).map((f) =>
    `- ${f.function_name}: ${f.what}`
  );
  sections.push(functionSummaries.join("\n"));
  sections.push("");

  sections.push("## Required Output");
  sections.push("Return ONLY valid JSON (no markdown fences) matching:");
  sections.push(`{
  "description": "<1-2 sentences: what this module provides>",
  "purpose": "<1 sentence: why this module exists in the project>",
  "approach": "<1 sentence: how it achieves its purpose>",
  "constraints": ["<key constraint or invariant>"]
}`);

  return sections.join("\n");
}

function parseFeatureResponse(raw: string, group: DirectoryGroup): EnhancedFeature {
  const cleaned = stripMarkdownFences(raw);
  const parsed = JSON.parse(cleaned) as {
    description: string;
    purpose: string;
    approach: string;
    constraints: string[];
  };

  const keyFiles = [...new Set(group.functions.map((f) => f.file_path))].slice(0, 10);

  return {
    name: group.directory,
    description: parsed.description,
    purpose: parsed.purpose,
    approach: parsed.approach,
    key_files: keyFiles,
    constraints: parsed.constraints,
    verification: [],
    function_count: group.functions.length,
  };
}

function buildFallbackFeature(group: DirectoryGroup): EnhancedFeature {
  const keyFiles = [...new Set(group.functions.map((f) => f.file_path))].slice(0, 10);

  return {
    name: group.directory,
    description: group.combined_purpose,
    purpose: `Provides ${group.directory} functionality`,
    approach: "Inferred from directory structure and function analysis",
    key_files: keyFiles,
    constraints: ["Auto-inferred, needs manual verification"],
    verification: [],
    function_count: group.functions.length,
  };
}

function summarizePurposes(purposes: string[]): string {
  if (purposes.length <= 3) {
    return purposes.join("; ");
  }
  return purposes.slice(0, 3).join("; ") + ` (and ${purposes.length - 3} more)`;
}

function escapeYamlString(text: string): string {
  return text.replace(/"/g, '\\"').replace(/\n/g, " ");
}
