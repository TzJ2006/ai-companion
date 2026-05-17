import type { ModularityInput, FunctionModularity, CohesionMetrics, CouplingMetrics, HiddenDependency, InterfaceClarity, RefactorRecommendation, InterfaceContract } from "./types.js";
export declare function computeCohesion(source: string, _name: string): CohesionMetrics;
export declare function computeCoupling(source: string, imports: string[]): CouplingMetrics;
export declare function detectHiddenDependencies(source: string): HiddenDependency[];
export declare function computeInterfaceClarity(input: ModularityInput): InterfaceClarity;
export declare function generateRecommendations(input: ModularityInput, cohesion: CohesionMetrics, coupling: CouplingMetrics, hiddenDeps: HiddenDependency[], clarity: InterfaceClarity): RefactorRecommendation[];
export declare function generateContract(input: ModularityInput, source: string): InterfaceContract;
export declare function analyzeModularityHeuristic(input: ModularityInput): FunctionModularity;
//# sourceMappingURL=heuristic.d.ts.map