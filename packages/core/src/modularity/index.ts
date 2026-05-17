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
} from "./types.js";
export { analyzeModularityHeuristic } from "./heuristic.js";
export { buildModularityPrompt } from "./prompt.js";
export { analyzeModularityWithLlm, analyzeModularityBatch } from "./analyzer.js";
export { aggregateModuleMetrics } from "./aggregator.js";
export { buildContractFileContent, emitContractFiles } from "./contracts.js";
