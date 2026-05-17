import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AnalysisInput, FunctionAnalysis, AnalyzerOptions } from "./types.js";
import { buildAnalysisPrompt } from "./prompt.js";
import { analyzeHeuristic } from "./heuristic.js";

const exec = promisify(execFile);

const DEFAULT_OPTIONS: AnalyzerOptions = {
  concurrency: 4,
  timeout: 30000,
  maxLlmCalls: 50,
  model: "haiku",
  fallbackToHeuristic: true,
};

function stripMarkdownFences(text: string): string {
  const lines = text.trim().split("\n");
  if (lines[0].startsWith("```")) {
    lines.shift();
  }
  if (lines.length > 0 && lines[lines.length - 1].startsWith("```")) {
    lines.pop();
  }
  return lines.join("\n").trim();
}

function parseAnalysisResponse(
  raw: string,
  input: AnalysisInput
): FunctionAnalysis {
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

export async function analyzeFunctionWithLlm(
  input: AnalysisInput,
  options: Partial<AnalyzerOptions> = {}
): Promise<FunctionAnalysis> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const prompt = buildAnalysisPrompt(input);

  try {
    const { stdout } = await exec(
      "claude",
      ["-p", "--bare", "--output-format", "text", "--model", opts.model, prompt],
      { timeout: opts.timeout }
    );

    return parseAnalysisResponse(stdout, input);
  } catch (error: unknown) {
    if (!opts.fallbackToHeuristic) {
      throw error;
    }
    return analyzeHeuristic(input);
  }
}

async function processChunk(
  chunk: AnalysisInput[],
  opts: AnalyzerOptions,
  useLlm: boolean,
  onProgress?: (done: number, total: number, current: string) => void,
  baseIndex?: number,
  totalCount?: number
): Promise<FunctionAnalysis[]> {
  const promises = chunk.map(async (input, i) => {
    const result = useLlm
      ? await analyzeFunctionWithLlm(input, opts)
      : analyzeHeuristic(input);

    if (onProgress && baseIndex !== undefined && totalCount !== undefined) {
      onProgress(baseIndex + i + 1, totalCount, input.function_name);
    }

    return result;
  });

  return Promise.all(promises);
}

export async function analyzeBatch(
  inputs: AnalysisInput[],
  options: Partial<AnalyzerOptions> = {},
  onProgress?: (done: number, total: number, current: string) => void
): Promise<FunctionAnalysis[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const results: FunctionAnalysis[] = [];
  const total = inputs.length;
  let llmCallsUsed = 0;

  for (let i = 0; i < total; i += opts.concurrency) {
    const chunk = inputs.slice(i, i + opts.concurrency);
    const remainingLlmBudget = opts.maxLlmCalls - llmCallsUsed;
    const useLlm = remainingLlmBudget > 0;

    const llmChunk = useLlm ? chunk.slice(0, remainingLlmBudget) : [];
    const heuristicChunk = useLlm ? chunk.slice(remainingLlmBudget) : chunk;

    const llmResults = llmChunk.length > 0
      ? await processChunk(llmChunk, opts, true, onProgress, i, total)
      : [];

    const heuristicResults = heuristicChunk.length > 0
      ? await processChunk(
          heuristicChunk,
          opts,
          false,
          onProgress,
          i + llmChunk.length,
          total
        )
      : [];

    results.push(...llmResults, ...heuristicResults);
    llmCallsUsed += llmChunk.length;
  }

  return results;
}
