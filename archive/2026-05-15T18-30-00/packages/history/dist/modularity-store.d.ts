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