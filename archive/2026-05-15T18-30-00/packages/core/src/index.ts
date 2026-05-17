export {
  getGitDiff,
  parseUnifiedDiff,
  annotateChanges,
  toChangeRecords,
} from "./diff/index.js";
export type {
  FileDiff,
  DiffHunk,
  DiffLine,
  AnnotationContext,
  AnnotatedChange,
} from "./diff/index.js";

export {
  buildTestPrompt,
  buildTestFilePath,
  parseTestResponse,
  generateTestSkeleton,
  buildLlmEnhancePrompt,
} from "./test-gen/index.js";
export type { TestGenerationConfig, GeneratedTest, TsTestGenConfig, GeneratedTsTest } from "./test-gen/index.js";


export {
  buildAnalysisPrompt,
  analyzeHeuristic,
  analyzeFunctionWithLlm,
  analyzeBatch,
} from "./analysis/index.js";
export type {
  AnalysisInput,
  AnalysisParam,
  AnalysisOutput,
  FunctionAnalysis,
  AnalysisStoreData,
  AnalyzerOptions,
} from "./analysis/index.js";


export {
  analyzeModularityHeuristic,
  buildModularityPrompt,
  analyzeModularityWithLlm,
  analyzeModularityBatch,
  aggregateModuleMetrics,
  buildContractFileContent,
  emitContractFiles,
} from "./modularity/index.js";
export type {
  CohesionMetrics,
  CouplingMetrics,
  HiddenDependency,
  InterfaceClarity,
  RefactorRecommendation,
  InterfaceContract,
  FunctionModularity,
  ModuleMetrics,
  ModularityStoreData,
  ModularityInput,
  ModularityAnalyzerOptions,
} from "./modularity/index.js";
