import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Local type definitions (mirroring core/src/modularity/types.ts)
// history cannot depend on core, so types are duplicated here.

export interface CohesionMetrics {
  score: number;
  responsibilities: string[];
  single_purpose: boolean;
}

export interface CouplingMetrics {
  score: number;
  external_calls: string[];
  import_dependencies: string[];
  global_accesses: string[];
  self_contained: boolean;
}

export interface HiddenDependency {
  kind: "env_var" | "global" | "filesystem" | "singleton" | "network" | "time";
  reference: string;
  line: number | null;
}

export interface InterfaceClarity {
  score: number;
  all_params_typed: boolean;
  return_type_declared: boolean;
  uses_any: boolean;
  minimal_params: boolean;
  issues: string[];
}

export interface RefactorRecommendation {
  kind: "extract_function" | "dependency_injection" | "split_module" | "simplify_interface" | "reduce_params";
  description: string;
  severity: "low" | "medium" | "high";
  target_lines?: [number, number];
  suggested_name?: string;
}

export interface InterfaceContract {
  input_type: string;
  output_type: string;
  contract_summary: string;
  is_implicit: boolean;
  adapter_signature: string | null;
}

export interface FunctionModularity {
  function_hash: string;
  file_path: string;
  function_name: string;
  class_name: string | null;
  cohesion: CohesionMetrics;
  coupling: CouplingMetrics;
  hidden_dependencies: HiddenDependency[];
  interface_clarity: InterfaceClarity;
  recommendations: RefactorRecommendation[];
  contract: InterfaceContract;
  is_god_function: boolean;
  line_count: number;
  analyzed_at: string;
  analysis_source: "llm" | "heuristic";
}

export interface ModuleMetrics {
  file_path: string;
  function_count: number;
  avg_cohesion: number;
  avg_coupling: number;
  god_function_count: number;
  self_contained_ratio: number;
  boundary_suggestions: string[];
}

export interface ModularityStoreData {
  project_root: string;
  analyzed_at: string;
  total_analyzed: number;
  functions: Record<string, FunctionModularity>;
  modules: Record<string, ModuleMetrics>;
}

export class ModularityStore {
  private filePath: string;
  private root: string;

  constructor(projectRoot: string) {
    this.root = projectRoot;
    this.filePath = join(projectRoot, ".devcompanion", "modularity.json");
  }

  async read(): Promise<ModularityStoreData | null> {
    if (!existsSync(this.filePath)) return null;
    const raw = await readFile(this.filePath, "utf-8");
    return JSON.parse(raw) as ModularityStoreData;
  }

  async write(data: ModularityStoreData): Promise<void> {
    await mkdir(join(this.root, ".devcompanion"), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(data, null, 2));
  }

  async getFunction(hash: string): Promise<FunctionModularity | null> {
    const data = await this.read();
    return data?.functions[hash] ?? null;
  }

  async upsertFunction(analysis: FunctionModularity): Promise<void> {
    const data = await this.read() ?? this.emptyStore();
    data.functions[analysis.function_hash] = analysis;
    data.total_analyzed = Object.keys(data.functions).length;
    data.analyzed_at = new Date().toISOString();
    await this.write(data);
  }

  async upsertBatch(analyses: FunctionModularity[], modules: Record<string, ModuleMetrics>): Promise<void> {
    const data = await this.read() ?? this.emptyStore();
    for (const a of analyses) {
      data.functions[a.function_hash] = a;
    }
    data.modules = modules;
    data.total_analyzed = Object.keys(data.functions).length;
    data.analyzed_at = new Date().toISOString();
    await this.write(data);
  }

  async writeModules(modules: Record<string, ModuleMetrics>): Promise<void> {
    const data = await this.read() ?? this.emptyStore();
    data.modules = modules;
    data.analyzed_at = new Date().toISOString();
    await this.write(data);
  }

  private emptyStore(): ModularityStoreData {
    return {
      project_root: this.root,
      analyzed_at: new Date().toISOString(),
      total_analyzed: 0,
      functions: {},
      modules: {},
    };
  }
}
