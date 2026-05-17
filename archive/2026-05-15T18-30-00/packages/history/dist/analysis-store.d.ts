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
export declare class AnalysisStore {
    private analysisPath;
    private root;
    constructor(projectRoot: string);
    read(): Promise<AnalysisStoreData | null>;
    write(data: AnalysisStoreData): Promise<void>;
    getFunction(hash: string): Promise<FunctionAnalysis | null>;
    upsertFunction(analysis: FunctionAnalysis): Promise<void>;
    upsertBatch(analyses: FunctionAnalysis[]): Promise<void>;
    private emptyStore;
}
//# sourceMappingURL=analysis-store.d.ts.map