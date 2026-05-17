import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ModularityInput, FunctionModularity, ModularityAnalyzerOptions } from "./types.js";
import { buildModularityPrompt } from "./prompt.js";
import { analyzeModularityHeuristic } from "./heuristic.js";

const exec = promisify(execFile);

const DEFAULT_OPTIONS: ModularityAnalyzerOptions = {
  concurrency: 4,
  timeout: 30000,
  maxLlmCalls: 50,
  model: "haiku",
  fallbackToHeuristic: true,
};

function stripMarkdownFences(text: string): string {
  return text.replace(/^```(?:json|typescript)?\s*\n?/gm, "").replace(/^```\s*$/gm, "").trim();
}

export async function analyzeModularityWithLlm(
  input: ModularityInput,
  options: Partial<ModularityAnalyzerOptions> = {}
): Promise<FunctionModularity> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const prompt = buildModularityPrompt(input);

  try {
    const { stdout } = await exec("claude", ["-p", "--bare", "--output-format", "text", "--model", opts.model, prompt], {
      timeout: opts.timeout,
      maxBuffer: 1024 * 1024,
    });

    const cleaned = stripMarkdownFences(stdout);
    const parsed = JSON.parse(cleaned);

    return {
      function_hash: input.function_hash,
      file_path: input.file_path,
      function_name: input.function_name,
      class_name: input.class_name,
      cohesion: parsed.cohesion,
      coupling: parsed.coupling,
      hidden_dependencies: parsed.hidden_dependencies ?? [],
      interface_clarity: parsed.interface_clarity,
      recommendations: parsed.recommendations ?? [],
      contract: parsed.contract,
      is_god_function: parsed.is_god_function ?? false,
      line_count: parsed.line_count ?? input.source_body.split("\n").length,
      analyzed_at: new Date().toISOString(),
      analysis_source: "llm",
    };
  } catch {
    if (opts.fallbackToHeuristic) {
      return analyzeModularityHeuristic(input);
    }
    throw new Error(`LLM analysis failed for ${input.function_name}`);
  }
}

export async function analyzeModularityBatch(
  inputs: ModularityInput[],
  options: Partial<ModularityAnalyzerOptions> = {},
  onProgress?: (done: number, total: number, current: string) => void
): Promise<FunctionModularity[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const results: FunctionModularity[] = [];
  let llmCallsUsed = 0;

  for (let i = 0; i < inputs.length; i += opts.concurrency) {
    const chunk = inputs.slice(i, i + opts.concurrency);
    const chunkResults = await Promise.all(
      chunk.map(async (input) => {
        if (llmCallsUsed >= opts.maxLlmCalls) {
          return analyzeModularityHeuristic(input);
        }
        llmCallsUsed++;
        return analyzeModularityWithLlm(input, opts);
      })
    );
    results.push(...chunkResults);
    for (let j = 0; j < chunk.length; j++) {
      onProgress?.(results.length - chunk.length + j + 1, inputs.length, chunk[j].function_name);
    }
  }

  return results;
}
