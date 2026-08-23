import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ModularityInput, FunctionModularity, ModularityAnalyzerOptions } from "./types.js";
import { buildModularityPrompt } from "./prompt.js";
import { analyzeModularityHeuristic } from "./heuristic.js";
import { stripMarkdownFences } from "../utils.js";

const exec = promisify(execFile);

const DEFAULT_OPTIONS: ModularityAnalyzerOptions = {
  concurrency: 4,
  timeout: 30000,
  maxLlmCalls: 50,
  model: "haiku",
  fallbackToHeuristic: true,
};

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
  } catch (error: unknown) {
    if (opts.fallbackToHeuristic) {
      console.warn(
        `[aidev] LLM modularity analysis failed for ${input.function_name}, falling back to heuristic: ${error instanceof Error ? error.message : String(error)}`
      );
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
    const remainingLlmBudget = opts.maxLlmCalls - llmCallsUsed;
    const llmChunk = remainingLlmBudget > 0 ? chunk.slice(0, remainingLlmBudget) : [];
    const heuristicChunk = remainingLlmBudget > 0 ? chunk.slice(remainingLlmBudget) : chunk;

    const llmResults = llmChunk.length > 0
      ? await Promise.all(llmChunk.map((input) => analyzeModularityWithLlm(input, opts)))
      : [];

    const heuristicResults = heuristicChunk.length > 0
      ? heuristicChunk.map((input) => analyzeModularityHeuristic(input))
      : [];

    results.push(...llmResults, ...heuristicResults);
    llmCallsUsed += llmChunk.length;

    for (let j = 0; j < chunk.length; j++) {
      onProgress?.(i + j + 1, inputs.length, chunk[j].function_name);
    }
  }

  return results;
}
