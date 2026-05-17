import type { FunctionAnalysis, AnalysisStoreData, AnalysisParam, AnalysisOutput } from "@aidev/types";
export type { FunctionAnalysis, AnalysisStoreData, AnalysisParam, AnalysisOutput };
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