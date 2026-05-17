export interface AnalysisInput {
  function_hash: string;
  file_path: string;
  function_name: string;
  class_name: string | null;
  signature: string;
  source_body: string;
  imports: string[];
  class_context: string | null;
}

export interface AnalysisParam {
  name: string;
  type: string | null;
  role: string;
  constraints: string;
}

export interface AnalysisOutput {
  type: string | null;
  meaning: string;
  nullable: boolean;
}

export interface FunctionAnalysis {
  function_hash: string;
  file_path: string;
  function_name: string;
  class_name: string | null;
  why: string;
  what: string;
  how: string;
  inputs: AnalysisParam[];
  outputs: AnalysisOutput;
  throws: string[];
  depends_on: string[];
  analyzed_at: string;
  analysis_source: "llm" | "heuristic";
}

export interface AnalysisStoreData {
  project_root: string;
  analyzed_at: string;
  total_analyzed: number;
  functions: Record<string, FunctionAnalysis>;
}

export interface AnalyzerOptions {
  concurrency: number;
  timeout: number;
  maxLlmCalls: number;
  model: string;
  fallbackToHeuristic: boolean;
}
