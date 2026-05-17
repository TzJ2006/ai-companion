import type { AnalysisInput, FunctionAnalysis, AnalyzerOptions } from "./types.js";
export declare function analyzeFunctionWithLlm(input: AnalysisInput, options?: Partial<AnalyzerOptions>): Promise<FunctionAnalysis>;
export declare function analyzeBatch(inputs: AnalysisInput[], options?: Partial<AnalyzerOptions>, onProgress?: (done: number, total: number, current: string) => void): Promise<FunctionAnalysis[]>;
//# sourceMappingURL=analyzer.d.ts.map