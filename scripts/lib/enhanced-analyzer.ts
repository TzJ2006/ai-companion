import { callClaude } from "../../packages/llm/src/index.ts";
import type { AnalysisInput, FunctionAnalysis } from "@aidev/types";
import { analyzeHeuristic } from "../../packages/core/src/analysis/heuristic.ts";
import { stripMarkdownFences } from "../../packages/core/src/utils.ts";
import type { ProjectContext } from "./project-context-generator.ts";


export interface EnhancedAnalyzerOptions {
  concurrency: number;
  timeout: number;
  model: string;
  retries: number;
  onProgress?: (done: number, total: number, current: string) => void;
}

const DEFAULT_OPTIONS: EnhancedAnalyzerOptions = {
  concurrency: 4,
  timeout: 30000,
  model: "haiku",
  retries: 1,
};

export async function analyzeAllFunctions(
  inputs: AnalysisInput[],
  projectContext: ProjectContext,
  options: Partial<EnhancedAnalyzerOptions> = {}
): Promise<FunctionAnalysis[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const contextSnippet = formatContextSnippet(projectContext);
  const results: FunctionAnalysis[] = [];
  const total = inputs.length;
  let consecutiveFailures = 0;
  let currentConcurrency = opts.concurrency;

  for (let i = 0; i < total; i += currentConcurrency) {
    const chunk = inputs.slice(i, i + currentConcurrency);

    const chunkResults = await Promise.allSettled(
      chunk.map((input) => analyzeSingleFunction(input, contextSnippet, opts))
    );

    let chunkFailures = 0;
    for (let j = 0; j < chunkResults.length; j++) {
      const result = chunkResults[j];
      if (result.status === "fulfilled") {
        results.push(result.value);
        consecutiveFailures = 0;
      } else {
        chunkFailures++;
        results.push(analyzeHeuristic(chunk[j]));
      }
    }

    consecutiveFailures = chunkFailures === chunk.length
      ? consecutiveFailures + 1
      : 0;

    if (consecutiveFailures >= 3 && currentConcurrency > 2) {
      currentConcurrency = 2;
    }

    if (opts.onProgress) {
      const done = Math.min(i + currentConcurrency, total);
      opts.onProgress(done, total, chunk[chunk.length - 1].function_name);
    }
  }

  return results;
}

async function analyzeSingleFunction(
  input: AnalysisInput,
  contextSnippet: string,
  options: EnhancedAnalyzerOptions
): Promise<FunctionAnalysis> {
  const prompt = buildEnhancedPrompt(input, contextSnippet);
  let lastError: unknown;

  for (let attempt = 0; attempt <= options.retries; attempt++) {
    try {
      const { output: stdout } = await callClaude(prompt, { model: options.model, timeout: options.timeout, maxOutputBytes: 0 });

      return parseAnalysisResponse(stdout, input);
    } catch (error: unknown) {
      lastError = error;
      if (attempt < options.retries) {
        await sleep(1000 * (attempt + 1));
      }
    }
  }

  throw lastError;
}

export function buildEnhancedPrompt(input: AnalysisInput, contextSnippet: string): string {
  const sections: string[] = [];

  sections.push("Analyze the following function and return a JSON object describing it.");
  sections.push("Be concise: each string field should be 1-2 sentences maximum, specific and direct.");
  sections.push("");

  sections.push(contextSnippet);
  sections.push("");

  if (input.imports.length > 0) {
    sections.push("## Imports (for context)");
    sections.push("```");
    sections.push(input.imports.join("\n"));
    sections.push("```");
    sections.push("");
  }

  if (input.class_context) {
    sections.push("## Class Context");
    sections.push(`This is a method of: ${input.class_context}`);
    sections.push("");
  }

  sections.push("## Function");
  sections.push(`File: ${input.file_path}`);
  sections.push(`Signature: ${input.signature}`);
  if (input.class_name) {
    sections.push(`Class: ${input.class_name}`);
  }
  sections.push("");
  sections.push("```");
  sections.push(input.source_body);
  sections.push("```");
  sections.push("");

  sections.push("## Required Output");
  sections.push("Return ONLY valid JSON (no markdown fences, no explanation) matching this schema:");
  sections.push(`{
  "function_hash": "${input.function_hash}",
  "file_path": "${input.file_path}",
  "function_name": "${input.function_name}",
  "class_name": ${input.class_name ? `"${input.class_name}"` : "null"},
  "why": "<string: 1-2 sentences explaining the purpose/motivation>",
  "what": "<string: 1-2 sentences describing what it does>",
  "how": "<string: 1-2 sentences summarizing the implementation approach>",
  "inputs": [{"name": "<param>", "type": "<type|null>", "role": "<role>", "constraints": "<constraints>"}],
  "outputs": {"type": "<type|null>", "meaning": "<meaning>", "nullable": <boolean>},
  "throws": ["<error descriptions>"],
  "depends_on": ["<called functions>"]
}`);

  return sections.join("\n");
}

function formatContextSnippet(context: ProjectContext): string {
  const lines: string[] = [];
  lines.push("## Project Context");
  lines.push(context.summary);

  if (context.architecture_overview) {
    lines.push(`Architecture: ${context.architecture_overview}`);
  }

  if (context.tech_stack.length > 0) {
    lines.push(`Tech: ${context.tech_stack.join(", ")}`);
  }

  const moduleEntries = Object.entries(context.module_responsibilities);
  if (moduleEntries.length > 0 && moduleEntries.length <= 10) {
    lines.push("Modules:");
    for (const [name, role] of moduleEntries) {
      lines.push(`- ${name}: ${role}`);
    }
  }

  return lines.join("\n");
}

function parseAnalysisResponse(raw: string, input: AnalysisInput): FunctionAnalysis {
  const cleaned = stripMarkdownFences(raw);
  const parsed = JSON.parse(cleaned) as FunctionAnalysis;

  return {
    ...parsed,
    function_hash: input.function_hash,
    file_path: input.file_path,
    function_name: input.function_name,
    class_name: input.class_name,
    analyzed_at: new Date().toISOString(),
    analysis_source: "llm",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
