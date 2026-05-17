import type { FunctionModularity, ModuleMetrics } from "./types.js";

export function aggregateModuleMetrics(functions: FunctionModularity[]): Record<string, ModuleMetrics> {
  const byFile = new Map<string, FunctionModularity[]>();

  for (const fn of functions) {
    const existing = byFile.get(fn.file_path) ?? [];
    existing.push(fn);
    byFile.set(fn.file_path, existing);
  }

  const modules: Record<string, ModuleMetrics> = {};

  for (const [filePath, fns] of byFile) {
    const avgCohesion = fns.reduce((sum, f) => sum + f.cohesion.score, 0) / fns.length;
    const avgCoupling = fns.reduce((sum, f) => sum + f.coupling.score, 0) / fns.length;
    const godCount = fns.filter(f => f.is_god_function).length;
    const selfContainedCount = fns.filter(f => f.coupling.self_contained).length;

    const suggestions: string[] = [];
    if (avgCoupling > 0.6) {
      suggestions.push("High average coupling — consider extracting shared dependencies into a service module");
    }
    if (godCount > 0) {
      suggestions.push(`${godCount} god function(s) detected — split into focused utilities`);
    }
    if (fns.length > 10) {
      suggestions.push("Module has many functions — consider splitting into sub-modules by responsibility");
    }
    if (selfContainedCount / fns.length < 0.3) {
      suggestions.push("Most functions depend on external state — review dependency injection patterns");
    }

    modules[filePath] = {
      file_path: filePath,
      function_count: fns.length,
      avg_cohesion: Math.round(avgCohesion * 100) / 100,
      avg_coupling: Math.round(avgCoupling * 100) / 100,
      god_function_count: godCount,
      self_contained_ratio: Math.round((selfContainedCount / fns.length) * 100) / 100,
      boundary_suggestions: suggestions,
    };
  }

  return modules;
}
