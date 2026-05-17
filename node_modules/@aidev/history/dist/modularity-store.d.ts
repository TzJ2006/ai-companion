import type { FunctionModularity, ModuleMetrics, ModularityStoreData, CohesionMetrics, CouplingMetrics, HiddenDependency, InterfaceClarity, RefactorRecommendation, InterfaceContract } from "@aidev/types";
export type { FunctionModularity, ModuleMetrics, ModularityStoreData, CohesionMetrics, CouplingMetrics, HiddenDependency, InterfaceClarity, RefactorRecommendation, InterfaceContract, };
export declare class ModularityStore {
    private filePath;
    private root;
    constructor(projectRoot: string);
    read(): Promise<ModularityStoreData | null>;
    write(data: ModularityStoreData): Promise<void>;
    getFunction(hash: string): Promise<FunctionModularity | null>;
    upsertFunction(analysis: FunctionModularity): Promise<void>;
    upsertBatch(analyses: FunctionModularity[], modules: Record<string, ModuleMetrics>): Promise<void>;
    writeModules(modules: Record<string, ModuleMetrics>): Promise<void>;
    private emptyStore;
}
//# sourceMappingURL=modularity-store.d.ts.map