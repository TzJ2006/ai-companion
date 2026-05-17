import type { ProjectIndex } from "@aidev/history";
import type { OnboardRenderOptions } from "./types.js";
import { renderOverview } from "./overview.js";
import { renderModules } from "./modules.js";
import { renderFunctionIndex } from "./index-panel.js";
import { buildOnboardPage } from "./page.js";

export type { FunctionReasonData, ReportData, OnboardRenderOptions } from "./types.js";

export function renderOnboardHtml(
  index: ProjectIndex,
  options: OnboardRenderOptions
): string {
  const title = options.title ?? "Project Onboarding Report";
  const modules = options.modules;
  const reportData = options.reportData;

  const totalFunctions = Object.keys(index.function_index).length;
  const files = [...new Set(Object.values(index.function_index).map(e => e.file_path))];

  const summaryHtml = renderOverview(totalFunctions, files.length, modules, reportData);
  const modulesHtml = renderModules(modules, reportData);
  const indexHtml = renderFunctionIndex(index.function_index);

  return buildOnboardPage(title, summaryHtml, modulesHtml, indexHtml);
}
