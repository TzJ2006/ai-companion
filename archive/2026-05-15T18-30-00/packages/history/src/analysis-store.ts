import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

// These types will be defined in @aidev/core, but since history can't depend on core,
// define them locally (same shape)
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

export class AnalysisStore {
  private analysisPath: string;
  private root: string;

  constructor(projectRoot: string) {
    this.root = projectRoot;
    this.analysisPath = join(projectRoot, ".devcompanion", "analysis.json");
  }

  async read(): Promise<AnalysisStoreData | null> {
    if (!existsSync(this.analysisPath)) return null;
    const raw = await readFile(this.analysisPath, "utf-8");
    return JSON.parse(raw) as AnalysisStoreData;
  }

  async write(data: AnalysisStoreData): Promise<void> {
    await mkdir(join(this.root, ".devcompanion"), { recursive: true });
    await writeFile(this.analysisPath, JSON.stringify(data, null, 2));
  }

  async getFunction(hash: string): Promise<FunctionAnalysis | null> {
    const data = await this.read();
    return data?.functions[hash] ?? null;
  }

  async upsertFunction(analysis: FunctionAnalysis): Promise<void> {
    const data = await this.read() ?? this.emptyStore();
    data.functions[analysis.function_hash] = analysis;
    data.total_analyzed = Object.keys(data.functions).length;
    data.analyzed_at = new Date().toISOString();
    await this.write(data);
  }

  async upsertBatch(analyses: FunctionAnalysis[]): Promise<void> {
    const data = await this.read() ?? this.emptyStore();
    for (const analysis of analyses) {
      data.functions[analysis.function_hash] = analysis;
    }
    data.total_analyzed = Object.keys(data.functions).length;
    data.analyzed_at = new Date().toISOString();
    await this.write(data);
  }

  private emptyStore(): AnalysisStoreData {
    return {
      project_root: this.root,
      analyzed_at: new Date().toISOString(),
      total_analyzed: 0,
      functions: {},
    };
  }
}
