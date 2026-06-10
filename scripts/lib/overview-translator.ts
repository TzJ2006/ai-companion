import { callClaude } from "../../packages/llm/src/index.ts";
import { stripMarkdownFences } from "../../packages/core/src/utils.ts";

export type Locale = "en" | "zh";

interface TranslatableTexts {
  project_description: string;
  features: Array<{
    feature: string;
    description: string;
    purpose: string;
    approach: string;
    constraints: string[];
    status: string;
    verifications: Array<{
      name: string;
      judgment_method: string;
      expected_outcome: string;
    }>;
  }>;
  functions: Array<{
    id: string;
    reason: string;
  }>;
}

interface UiLabels {
  page_title: string;
  report_heading: string;
  features_passing_label: string;
  verifications_passing_label: string;
  function_index_label: string;
  human_confirmed_label: string;
  export_button: string;
  import_button: string;
  feature_list_heading: string;
  function_index_heading: string;
  what_section: string;
  how_section: string;
  verify_section: string;
  dependencies_section: string;
  called_by_section: string;
  purpose_prefix: string;
  key_files_label: string;
  constraints_label: string;
  confirm_verification_label: string;
  command_label: string;
  judgment_method_label: string;
  expected_outcome_label: string;
  actual_output_label: string;
  conclusion_label: string;
  status_pass: string;
  status_fail: string;
  status_partial: string;
  no_output: string;
  belongs_to_ecl_heading: string;
  not_in_ecl_heading: string;
  suggest_delete_heading: string;
  suggest_delete_badge: string;
  confirm_delete_label: string;
  none_label: string;
  no_direct_calls: string;
  not_called_by_any: string;
  async_function: string;
  sync_function: string;
  exported: string;
  not_exported: string;
  ecl_belongs_prefix: string;
  parameters_label: string;
  return_type_label: string;
  line_range_label: string;
  no_parameters: string;
  no_return_type: string;
  line_range_format: string;
  test_file_label: string;
  test_status_label: string;
  no_test: string;
  empty_function_index: string;
  import_success_alert: string;
  import_fail_alert: string;
}

export const UI_LABELS_ZH: UiLabels = {
  page_title: "概览报告 — AI Dev Companion",
  report_heading: "概览报告",
  features_passing_label: "功能通过",
  verifications_passing_label: "验证通过",
  function_index_label: "函数索引",
  human_confirmed_label: "已人工确认",
  export_button: "导出确认状态",
  import_button: "导入确认状态",
  feature_list_heading: "Evolving Constraint Language 功能列表",
  function_index_heading: "函数索引",
  what_section: "是什么",
  how_section: "如何实现",
  verify_section: "验证",
  dependencies_section: "直接调用",
  called_by_section: "被谁调用",
  purpose_prefix: "目的：",
  key_files_label: "关键文件",
  constraints_label: "约束条件",
  confirm_verification_label: "确认此验证有效",
  command_label: "命令",
  judgment_method_label: "判断方式",
  expected_outcome_label: "预期结果",
  actual_output_label: "实际输出",
  conclusion_label: "结论",
  status_pass: "通过",
  status_fail: "失败",
  status_partial: "部分通过",
  no_output: "（无输出）",
  belongs_to_ecl_heading: "归属 Evolving Constraint Language 功能的函数",
  not_in_ecl_heading: "未归属任何 Evolving Constraint Language 功能的函数",
  suggest_delete_heading: "建议删除的孤立函数",
  suggest_delete_badge: "建议删除",
  confirm_delete_label: "确认是否应删除",
  none_label: "无",
  no_direct_calls: "无直接调用",
  not_called_by_any: "未被任何函数调用",
  async_function: "异步函数",
  sync_function: "同步函数",
  exported: "已导出",
  not_exported: "未导出",
  ecl_belongs_prefix: "归属 Evolving Constraint Language 功能: ",
  parameters_label: "参数",
  return_type_label: "返回值类型",
  line_range_label: "行范围",
  no_parameters: "无参数",
  no_return_type: "无返回值类型",
  line_range_format: "第 {start} 行到第 {end} 行",
  test_file_label: "测试文件",
  test_status_label: "测试状态",
  no_test: "无对应测试",
  empty_function_index: "函数索引将在完整模式下生成（需要 WebAssembly 解析器支持）",
  import_success_alert: "确认状态已导入",
  import_fail_alert: "导入失败: 无效的 JSON 文件",
};

export const UI_LABELS_EN: UiLabels = {
  page_title: "Overview Report — AI Dev Companion",
  report_heading: "Overview Report",
  features_passing_label: "features passing",
  verifications_passing_label: "verifications passing",
  function_index_label: "function index",
  human_confirmed_label: "manually confirmed",
  export_button: "Export Confirmation",
  import_button: "Import Confirmation",
  feature_list_heading: "Evolving Constraint Language Feature List",
  function_index_heading: "Function Index",
  what_section: "What",
  how_section: "How",
  verify_section: "Verify",
  dependencies_section: "Dependencies",
  called_by_section: "Called By",
  purpose_prefix: "Purpose: ",
  key_files_label: "Key Files",
  constraints_label: "Constraints",
  confirm_verification_label: "Confirm this verification is valid",
  command_label: "Command",
  judgment_method_label: "Judgment Method",
  expected_outcome_label: "Expected Outcome",
  actual_output_label: "Actual Output",
  conclusion_label: "Conclusion",
  status_pass: "Pass",
  status_fail: "Fail",
  status_partial: "Partial",
  no_output: "(no output)",
  belongs_to_ecl_heading: "Functions belonging to ECL features",
  not_in_ecl_heading: "Functions not belonging to any ECL feature",
  suggest_delete_heading: "Orphan functions suggested for deletion",
  suggest_delete_badge: "suggest delete",
  confirm_delete_label: "Confirm whether to delete",
  none_label: "None",
  no_direct_calls: "No direct calls",
  not_called_by_any: "Not called by any function",
  async_function: "async",
  sync_function: "sync",
  exported: "exported",
  not_exported: "not exported",
  ecl_belongs_prefix: "ECL Feature: ",
  parameters_label: "Parameters",
  return_type_label: "Return Type",
  line_range_label: "Line Range",
  no_parameters: "No parameters",
  no_return_type: "No return type",
  line_range_format: "Line {start} to Line {end}",
  test_file_label: "Test File",
  test_status_label: "Test Status",
  no_test: "No corresponding test",
  empty_function_index: "Function index will be generated in full mode (requires WebAssembly parser support)",
  import_success_alert: "Confirmation state imported successfully",
  import_fail_alert: "Import failed: invalid JSON file",
};

export function getUiLabels(locale: Locale): UiLabels {
  return locale === "en" ? UI_LABELS_EN : UI_LABELS_ZH;
}

export function getStatusLabel(status: string, locale: Locale): string {
  const labels = getUiLabels(locale);
  if (status === "通过" || status === "Pass") return labels.status_pass;
  if (status === "失败" || status === "Fail") return labels.status_fail;
  return labels.status_partial;
}

export function formatLineRange(start: number, end: number, locale: Locale): string {
  const labels = getUiLabels(locale);
  return labels.line_range_format
    .replace("{start}", String(start))
    .replace("{end}", String(end));
}

function extractTranslatableTexts(overviewData: {
  project_description: string;
  features: Array<{
    feature: string;
    description: string;
    purpose: string;
    approach: string;
    constraints: string[];
    status: string;
    verifications: Array<{
      name: string;
      judgment_method: string;
      expected_outcome: string;
    }>;
  }>;
  functions: Array<{
    id: string;
    reason: string;
  }>;
}): TranslatableTexts {
  return {
    project_description: overviewData.project_description,
    features: overviewData.features.map((feature) => ({
      feature: feature.feature,
      description: feature.description,
      purpose: feature.purpose,
      approach: feature.approach,
      constraints: feature.constraints,
      status: feature.status,
      verifications: feature.verifications.map((verification) => ({
        name: verification.name,
        judgment_method: verification.judgment_method,
        expected_outcome: verification.expected_outcome,
      })),
    })),
    functions: overviewData.functions.map((functionData) => ({
      id: functionData.id,
      reason: functionData.reason,
    })),
  };
}

function buildTranslationPrompt(texts: TranslatableTexts, targetLocale: Locale): string {
  const targetLanguage = targetLocale === "en" ? "English" : "Chinese (Simplified)";

  return `You are a professional translator. Translate ALL text values in the following JSON to pure ${targetLanguage}.

Rules:
- Translate ONLY the string values, never modify the JSON structure or keys.
- Keep technical terms (function names, file paths, code identifiers) unchanged.
- "通过" means "Pass", "失败" means "Fail", "部分通过" means "Partial" (or reverse for Chinese).
- Return ONLY valid JSON. No markdown fences, no explanation.
- Every single text value must be in ${targetLanguage} — no mixing of languages.

JSON to translate:
${JSON.stringify(texts, null, 2)}`;
}

// Translation is split into small batches and run sequentially so a single
// Claude call never has to read and re-emit the entire overview at once. The
// full payload (project description + all feature text + every function reason)
// previously overran the CLI timeout. Each batch is small and fast; a failed
// batch falls back to the original text instead of crashing the whole run.
const TRANSLATION_TIMEOUT_MS = 180_000;
const FUNCTION_BATCH_SIZE = 80;

async function translateJsonPayload(
  payload: TranslatableTexts,
  targetLocale: Locale,
  label: string
): Promise<TranslatableTexts | null> {
  const prompt = buildTranslationPrompt(payload, targetLocale);
  try {
    const { output } = await callClaude(prompt, {
      model: "haiku",
      timeout: TRANSLATION_TIMEOUT_MS,
      maxOutputBytes: 0,
    });
    return JSON.parse(stripMarkdownFences(output.trim())) as TranslatableTexts;
  } catch (error) {
    const name = error instanceof Error ? error.name : "error";
    console.warn(`  Translation (${label}) failed [${name}]; keeping original text.`);
    return null;
  }
}

export async function translateOverviewData<T extends {
  project_description: string;
  features: Array<{
    feature: string;
    description: string;
    purpose: string;
    approach: string;
    constraints: string[];
    status: string;
    verifications: Array<{
      name: string;
      judgment_method: string;
      expected_outcome: string;
    }>;
  }>;
  functions: Array<{
    id: string;
    reason: string;
  }>;
}>(overviewData: T, targetLocale: Locale): Promise<T> {
  console.log(`  Translating to ${targetLocale === "en" ? "English" : "Chinese"}...`);

  const source = extractTranslatableTexts(overviewData);
  const result = JSON.parse(JSON.stringify(overviewData)) as T;

  // Pass 1 — core texts (project description + features). Small: one call.
  const core = await translateJsonPayload(
    { project_description: source.project_description, features: source.features, functions: [] },
    targetLocale,
    "core"
  );
  if (core) {
    result.project_description = core.project_description ?? result.project_description;
    for (let i = 0; i < result.features.length; i++) {
      const s = core.features?.[i];
      if (!s) continue;
      result.features[i].description = s.description ?? result.features[i].description;
      result.features[i].purpose = s.purpose ?? result.features[i].purpose;
      result.features[i].approach = s.approach ?? result.features[i].approach;
      result.features[i].constraints = s.constraints ?? result.features[i].constraints;
      result.features[i].status = s.status ?? result.features[i].status;
      for (let j = 0; j < result.features[i].verifications.length; j++) {
        const sv = s.verifications?.[j];
        if (!sv) continue;
        result.features[i].verifications[j].name = sv.name ?? result.features[i].verifications[j].name;
        result.features[i].verifications[j].judgment_method = sv.judgment_method ?? result.features[i].verifications[j].judgment_method;
        result.features[i].verifications[j].expected_outcome = sv.expected_outcome ?? result.features[i].verifications[j].expected_outcome;
      }
    }
  }

  // Pass 2 — function reasons, in sequential batches. Each batch is independent;
  // a failed batch leaves its reasons untranslated rather than aborting the run.
  for (let start = 0; start < source.functions.length; start += FUNCTION_BATCH_SIZE) {
    const batch = source.functions.slice(start, start + FUNCTION_BATCH_SIZE);
    const label = `functions ${start + 1}-${start + batch.length} of ${source.functions.length}`;
    const translated = await translateJsonPayload(
      { project_description: "", features: [], functions: batch },
      targetLocale,
      label
    );
    if (!translated || !Array.isArray(translated.functions)) continue;
    for (let j = 0; j < batch.length; j++) {
      const s = translated.functions[j];
      if (s && typeof s.reason === "string") {
        result.functions[start + j].reason = s.reason;
      }
    }
  }

  return result;
}
