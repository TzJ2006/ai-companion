import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  FunctionModularity,
  ModuleMetrics,
  ModularityStoreData,
  CohesionMetrics,
  CouplingMetrics,
  HiddenDependency,
  InterfaceClarity,
  RefactorRecommendation,
  InterfaceContract,
} from "@aidev/types";

export type {
  FunctionModularity,
  ModuleMetrics,
  ModularityStoreData,
  CohesionMetrics,
  CouplingMetrics,
  HiddenDependency,
  InterfaceClarity,
  RefactorRecommendation,
  InterfaceContract,
};

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
