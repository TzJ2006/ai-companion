export { HistoryStore } from "./store.js";
export { projectSession, ProjectionError } from "./projector.js";
export type { ProjectionManifest, ProjectionStorage } from "./projector.js";
export {
  applyManagedGitignore,
  hasManagedGitignoreBlock,
  managedGitignoreBlock,
  visibilityToGitignoreProfile,
  GITIGNORE_MANAGED_START,
  GITIGNORE_MANAGED_END,
} from "./managed-gitignore.js";
export type { RepoVisibility, GitignoreProfile } from "./managed-gitignore.js";
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
