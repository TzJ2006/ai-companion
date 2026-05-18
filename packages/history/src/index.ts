export { HistoryStore } from "./store.js";
export type {
  ChangeRecord,
  ReviewSession,
  FileHistory,
  FunctionHistory,
  ProjectIndex,
  FunctionIndexEntry,
  EclContext,
} from "./types.js";
export { AnalysisStore } from "./analysis-store.js";
export type { FunctionAnalysis, AnalysisStoreData, AnalysisParam, AnalysisOutput } from "./analysis-store.js";

export { ModularityStore } from "./modularity-store.js";
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
} from "./modularity-store.js";
