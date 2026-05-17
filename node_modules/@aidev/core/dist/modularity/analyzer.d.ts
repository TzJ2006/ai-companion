import type { ModularityInput, FunctionModularity, ModularityAnalyzerOptions } from "./types.js";
export declare function analyzeModularityWithLlm(input: ModularityInput, options?: Partial<ModularityAnalyzerOptions>): Promise<FunctionModularity>;
export declare function analyzeModularityBatch(inputs: ModularityInput[], options?: Partial<ModularityAnalyzerOptions>, onProgress?: (done: number, total: number, current: string) => void): Promise<FunctionModularity[]>;
//# sourceMappingURL=analyzer.d.ts.map