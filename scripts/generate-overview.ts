#!/usr/bin/env npx tsx
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { resolve, join, relative, extname } from "node:path";
import { execSync } from "node:child_process";
import { parseEclYaml } from "./lib/ecl-parser.ts";
import { runVerification } from "./lib/verification-runner.ts";
import { archiveFile } from "./lib/archive.ts";
import {
  loadConfirmationState,
  shouldPreserveConfirmation,
  generateCheckboxId,
  createEmptyState,
} from "./lib/confirmation-manager.ts";
import { analyzeFileCalls, buildCallGraph, formatFunctionId } from "../packages/ast/src/call-graph.ts";
import { parseFileAuto, getSupportedExtensions } from "../packages/ast/src/index.ts";
import {
  buildAttributionMap,
  detectEntryFiles,
  detectTestHelperFiles,
} from "./lib/ecl-attribution.ts";
import { generateHeuristicReason } from "./lib/heuristic-reason.ts";
import type { VerificationResult } from "./lib/verification-runner.ts";
import type { FeatureEntry } from "./lib/ecl-parser.ts";
import type { ConfirmationState } from "./lib/confirmation-manager.ts";
import type { CallGraph } from "../packages/ast/src/call-graph.ts";
import { translateOverviewData, getUiLabels, getStatusLabel, formatLineRange } from "./lib/overview-translator.ts";
import type { Locale } from "./lib/overview-translator.ts";

const SCRIPT_ROOT = resolve(import.meta.dirname, "..");

function resolveTargetProject(): string {
  const targetIndex = process.argv.indexOf("--target");
  if (targetIndex !== -1 && process.argv[targetIndex + 1]) {
    return resolve(process.argv[targetIndex + 1]);
  }
  return SCRIPT_ROOT;
}

const PROJECT_ROOT = resolveTargetProject();
const ECL_DIRECTORY = join(PROJECT_ROOT, "docs", "ecl");
const REPORTS_DIRECTORY = join(PROJECT_ROOT, ".devcompanion", "reports");
const ARCHIVE_DIRECTORY = join(REPORTS_DIRECTORY, "archive");
const CONFIRMATION_PATH = join(PROJECT_ROOT, ".devcompanion", "confirmations", "overview-confirmation.json");
const CONFIRMATION_ARCHIVE_DIRECTORY = join(PROJECT_ROOT, ".devcompanion", "confirmations", "archive");
const OUTPUT_PATH = join(REPORTS_DIRECTORY, "overview.html");

interface FeatureReportData {
  feature: string;
  description: string;
  purpose: string;
  approach: string;
  key_files: string[];
  constraints: string[];
  verifications: VerificationResult[];
  status: "通过" | "失败" | "部分通过";
  implementing_functions: string[];
}

interface FunctionReportData {
  id: string;
  function_name: string;
  class_name: string | null;
  file_path: string;
  start_line: number;
  end_line: number;
  reason: string;
  is_async: boolean;
  is_exported: boolean;
  signature: string;
  return_type: string | null;
  parameters: string[];
  ecl_features: string[];
  calls: string[];
  called_by: string[];
  orphan_status: "belongs_to_ecl" | "not_in_any_ecl" | "suggest_delete";
  test_file: string | null;
  test_status: "passed" | "failed" | "no-test";
  test_assertions: Array<{ name: string; status: string; judgment: string }>;
}

interface OverviewData {
  generated_at: string;
  project_description: string;
  total_features: number;
  total_functions: number;
  features_passing: number;
  total_verifications: number;
  verifications_passing: number;
  features: FeatureReportData[];
  functions: FunctionReportData[];
  confirmation_state: ConfirmationState;
}

function resolveProjectDescription(): string {
  const packageJsonPath = join(PROJECT_ROOT, "package.json");
  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
      if (packageJson.description) return packageJson.description;
    } catch { /* ignore */ }
  }

  const pyprojectPath = join(PROJECT_ROOT, "pyproject.toml");
  if (existsSync(pyprojectPath)) {
    try {
      const content = readFileSync(pyprojectPath, "utf-8");
      const descMatch = content.match(/description\s*=\s*"([^"]+)"/);
      if (descMatch) return descMatch[1];
    } catch { /* ignore */ }
  }

  const readmePath = join(PROJECT_ROOT, "README.md");
  if (existsSync(readmePath)) {
    try {
      const readme = readFileSync(readmePath, "utf-8");
      const lines = readme.split("\n").filter((line) => line.trim() && !line.startsWith("#"));
      if (lines.length > 0) return lines[0].trim().slice(0, 300);
    } catch { /* ignore */ }
  }

  const projectName = PROJECT_ROOT.split(/[\\/]/).filter(Boolean).pop() ?? "project";
  return `${projectName} 项目概览`;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const verifyOnly = process.argv.includes("--verify-only");

  console.log("Generating Overview Report...");
  console.log(`  Project root: ${PROJECT_ROOT}`);
  console.log(`  Mode: ${dryRun ? "dry run" : verifyOnly ? "verify only" : "full"}`);

  mkdirSync(REPORTS_DIRECTORY, { recursive: true });
  mkdirSync(ARCHIVE_DIRECTORY, { recursive: true });

  const archiveResult = await archiveFile(OUTPUT_PATH, ARCHIVE_DIRECTORY);
  if (archiveResult.archived) {
    console.log(`  Archived previous version: ${archiveResult.archive_path}`);
    if (archiveResult.exceeded_limit) {
      console.log(`  WARNING: Archive has more than 10 versions. Excess files:`);
      for (const file of archiveResult.excess_files) {
        console.log(`    - ${file}`);
      }
      console.log(`  Please review and delete manually if no longer needed.`);
    }
  }

  const confirmationState = await loadConfirmationState(CONFIRMATION_PATH);

  const eclFiles = existsSync(ECL_DIRECTORY) ? readdirSync(ECL_DIRECTORY).filter((file) => file.endsWith(".yaml")) : [];
  const allFeatures: FeatureEntry[] = [];

  for (const file of eclFiles) {
    const content = readFileSync(join(ECL_DIRECTORY, file), "utf-8");
    if (content.includes("features:")) {
      const features = parseEclYaml(content);
      allFeatures.push(...features);
    }
  }

  console.log(`  Found ${allFeatures.length} Evolving Constraint Language features`);

  const featureReports: FeatureReportData[] = [];
  for (const feature of allFeatures) {
    const verifications = dryRun
      ? feature.verification.map((item) => ({
          name: item.name,
          command: item.command,
          judgment_method: "乾跑模式 - 未执行验证命令",
          expected_outcome: item.expect ?? "命令执行成功",
          actual_output: "(乾跑模式)",
          passed: true,
          expect: item.expect,
        }))
      : feature.verification.map((item) => runVerification(item, PROJECT_ROOT));

    const passCount = verifications.filter((verification) => verification.passed).length;
    const status: FeatureReportData["status"] =
      passCount === verifications.length ? "通过" :
      passCount === 0 ? "失败" : "部分通过";

    featureReports.push({
      feature: feature.feature,
      description: feature.description,
      purpose: feature.purpose,
      approach: feature.implementation.approach,
      key_files: feature.implementation.key_files,
      constraints: feature.implementation.constraints,
      verifications,
      status,
      implementing_functions: [],
    });
  }

  const functions: FunctionReportData[] = [];

  if (!verifyOnly) {
    console.log("  Scanning project for functions and building call graph...");
    const supportedExtensions = new Set(getSupportedExtensions());
    const sourceFiles = collectSourceFiles(PROJECT_ROOT, supportedExtensions);
    console.log(`  Found ${sourceFiles.length} source files`);

    const allCallEntries = [];
    const fileExports = new Map<string, Set<string>>();

    for (const file of sourceFiles) {
      try {
        const entries = await analyzeFileCalls(file);
        allCallEntries.push(...entries);

        const parsed = await parseFileAuto(file);
        const relPath = relative(PROJECT_ROOT, file);
        const exportedNames = new Set<string>();

        for (const functionSignature of parsed.functions) {
          exportedNames.add(functionSignature.name);
        }
        fileExports.set(file, exportedNames);

        for (const functionSignature of parsed.functions) {
          const functionId = formatFunctionId(file, functionSignature.class_name, functionSignature.name);
          const parameters = functionSignature.params.map((parameter) =>
            `${parameter.name}${parameter.type ? ": " + parameter.type : ""}`
          );
          const signature = `${functionSignature.is_async ? "async " : ""}${functionSignature.class_name ? functionSignature.class_name + "." : ""}${functionSignature.name}(${parameters.join(", ")})${functionSignature.return_type ? ": " + functionSignature.return_type : ""}`;

          functions.push({
            id: functionId,
            function_name: functionSignature.name,
            class_name: functionSignature.class_name,
            file_path: relPath,
            start_line: functionSignature.start_line,
            end_line: functionSignature.end_line,
            reason: generateHeuristicReason(functionSignature),
            is_async: functionSignature.is_async,
            is_exported: true,
            signature,
            return_type: functionSignature.return_type,
            parameters,
            ecl_features: [],
            calls: [],
            called_by: [],
            orphan_status: "not_in_any_ecl",
            test_file: null,
            test_status: "no-test",
            test_assertions: [],
          });
        }

        for (const classInfo of parsed.classes) {
          for (const method of classInfo.methods) {
            const functionId = formatFunctionId(file, method.class_name, method.name);
            const parameters = method.params.map((parameter) =>
              `${parameter.name}${parameter.type ? ": " + parameter.type : ""}`
            );
            const signature = `${method.is_async ? "async " : ""}${method.class_name ? method.class_name + "." : ""}${method.name}(${parameters.join(", ")})${method.return_type ? ": " + method.return_type : ""}`;

            functions.push({
              id: functionId,
              function_name: method.name,
              class_name: method.class_name,
              file_path: relPath,
              start_line: method.start_line,
              end_line: method.end_line,
              reason: generateHeuristicReason(method),
              is_async: method.is_async,
              is_exported: false,
              signature,
              return_type: method.return_type,
              parameters,
              ecl_features: [],
              calls: [],
              called_by: [],
              orphan_status: "not_in_any_ecl",
              test_file: null,
              test_status: "no-test",
              test_assertions: [],
            });
          }
        }
      } catch {
        // skip files that fail to parse
      }
    }

    console.log(`  Found ${functions.length} functions`);
    console.log("  Building call graph and attribution map...");

    const callGraph = buildCallGraph(allCallEntries);

    for (const functionData of functions) {
      const fullPath = resolve(PROJECT_ROOT, functionData.file_path);
      const functionId = formatFunctionId(fullPath, functionData.class_name, functionData.function_name);

      const callEntry = callGraph.entries.find((entry) =>
        entry.file_path === fullPath &&
        entry.function_name === functionData.function_name &&
        entry.class_name === functionData.class_name
      );
      if (callEntry) {
        functionData.calls = callEntry.calls;
      }

      const calledBy = callGraph.reverse_index[functionId];
      if (calledBy) {
        functionData.called_by = calledBy.map((callerId) => {
          const parts = callerId.split("::");
          return parts[parts.length - 1];
        });
      }

      const belongingFeatures: string[] = [];
      const normalizedPath = functionData.file_path.replace(/\\/g, "/");
      for (const feature of allFeatures) {
        for (const keyFile of feature.implementation.key_files) {
          const normalizedKeyFile = keyFile.replace(/\\/g, "/");
          if (normalizedPath === normalizedKeyFile || normalizedPath.endsWith(normalizedKeyFile)) {
            belongingFeatures.push(feature.feature);
            break;
          }
        }
      }
      functionData.ecl_features = belongingFeatures;

      if (belongingFeatures.length > 0) {
        functionData.orphan_status = "belongs_to_ecl";
      } else {
        const entryFiles = detectEntryFiles(sourceFiles.map((file) => relative(PROJECT_ROOT, file)));
        const testHelperFiles = detectTestHelperFiles(sourceFiles.map((file) => relative(PROJECT_ROOT, file)));
        const isEntry = entryFiles.has(functionData.file_path);
        const isTestHelper = testHelperFiles.has(functionData.file_path);
        const hasCallers = functionData.called_by.length > 0;

        if (!hasCallers && !functionData.is_exported && !isEntry && !isTestHelper) {
          functionData.orphan_status = "suggest_delete";
        } else {
          functionData.orphan_status = "not_in_any_ecl";
        }
      }
    }

    for (const featureReport of featureReports) {
      featureReport.implementing_functions = functions
        .filter((functionData) => functionData.ecl_features.includes(featureReport.feature))
        .map((functionData) => functionData.id);
    }

    console.log(`  Attribution complete: ${functions.filter((f) => f.orphan_status === "belongs_to_ecl").length} belong to Evolving Constraint Language, ${functions.filter((f) => f.orphan_status === "not_in_any_ecl").length} not in any, ${functions.filter((f) => f.orphan_status === "suggest_delete").length} suggest delete`);
  }

  const overviewData: OverviewData = {
    generated_at: new Date().toISOString(),
    project_description: resolveProjectDescription(),
    total_features: featureReports.length,
    total_functions: functions.length,
    features_passing: featureReports.filter((feature) => feature.status === "通过").length,
    total_verifications: featureReports.reduce((sum, feature) => sum + feature.verifications.length, 0),
    verifications_passing: featureReports.reduce((sum, feature) => sum + feature.verifications.filter((verification) => verification.passed).length, 0),
    features: featureReports,
    functions,
    confirmation_state: confirmationState,
  };

  const outputPathEn = join(REPORTS_DIRECTORY, "overview-en.html");
  const outputPathZh = join(REPORTS_DIRECTORY, "overview-zh.html");

  const skipTranslation = process.argv.includes("--skip-translation");

  if (skipTranslation) {
    const html = renderOverviewHtml(overviewData, "zh");
    writeFileSync(OUTPUT_PATH, html);
    console.log(`\n  Report written to: ${OUTPUT_PATH}`);
  } else {
    console.log("\n  Starting translation for bilingual output...");

    // Sequential, NOT Promise.all: running both locales at once spawned two
    // concurrent Claude CLI sessions that contended and overran the timeout.
    // One locale at a time keeps each batch fast and reliable.
    const enData = await translateOverviewData(overviewData, "en");
    const zhData = await translateOverviewData(overviewData, "zh");

    const htmlEn = renderOverviewHtml(enData, "en");
    const htmlZh = renderOverviewHtml(zhData, "zh");

    writeFileSync(outputPathEn, htmlEn);
    writeFileSync(outputPathZh, htmlZh);

    console.log(`\n  English report written to: ${outputPathEn}`);
    console.log(`  Chinese report written to: ${outputPathZh}`);
  }

  console.log(`  Features: ${overviewData.features_passing}/${overviewData.total_features} passing`);
  console.log(`  Verifications: ${overviewData.verifications_passing}/${overviewData.total_verifications} passing`);
}

function renderOverviewHtml(data: OverviewData, locale: Locale): string {
  const t = getUiLabels(locale);
  const htmlLang = locale === "en" ? "en" : "zh-CN";
  const featuresHtml = data.features.map((feature) => renderFeatureCard(feature, data.confirmation_state, locale)).join("\n");

  const functionsHtml = data.functions.length > 0
    ? renderFunctionIndex(data.functions, data.confirmation_state, locale)
    : `<div class="empty-section">${t.empty_function_index}</div>`;

  return `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t.page_title}</title>
  <style>
${getStyles()}
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>${t.report_heading}</h1>
      <p class="subtitle">Generated: ${data.generated_at}</p>
      <p class="project-description">${escapeHtml(data.project_description)}</p>
    </header>

    <section class="summary-bar">
      <div class="summary-stat">
        <strong>${data.features_passing}</strong>/<strong>${data.total_features}</strong>
        <span>${t.features_passing_label}</span>
      </div>
      <div class="summary-stat">
        <strong>${data.verifications_passing}</strong>/<strong>${data.total_verifications}</strong>
        <span>${t.verifications_passing_label}</span>
      </div>
      <div class="summary-stat">
        <strong>${data.total_functions}</strong>
        <span>${t.function_index_label}</span>
      </div>
      <div class="summary-stat checkbox-progress">
        <strong id="checkbox-confirmed">0</strong>/<strong id="checkbox-total">0</strong>
        <span>${t.human_confirmed_label}</span>
      </div>
    </section>

    <div class="toolbar">
      <button onclick="exportConfirmation()">${t.export_button}</button>
      <button onclick="importConfirmation()">${t.import_button}</button>
      <input type="file" id="import-file-input" accept=".json" style="display:none" onchange="handleImportFile(event)">
    </div>

    <section class="features-section">
      <h2>${t.feature_list_heading}</h2>
      ${featuresHtml}
    </section>

    <section class="functions-section">
      <h2>${t.function_index_heading}</h2>
      ${functionsHtml}
    </section>
  </div>

  <script>
${getScript(data.confirmation_state, locale)}
  </script>
</body>
</html>`;
}

function renderFeatureCard(feature: FeatureReportData, confirmationState: ConfirmationState, locale: Locale): string {
  const t = getUiLabels(locale);
  const status = feature.status as string;
  const statusClass = (status === "通过" || status === "Pass") ? "status-pass" :
    (status === "失败" || status === "Fail") ? "status-fail" : "status-partial";
  const statusLabel = getStatusLabel(feature.status, locale);

  const verificationsHtml = feature.verifications.map((verification) => {
    const checkboxId = generateCheckboxId("verification", feature.feature, verification.name);
    const isConfirmed = confirmationState.entries[checkboxId]?.confirmed ?? false;
    const preserveState = isConfirmed && shouldPreserveConfirmation(
      confirmationState.entries[checkboxId],
      verification.command,
      verification.passed ? "passed" : "failed"
    );

    return `
      <div class="verification-item">
        <div class="verification-header">
          <span class="verification-icon ${verification.passed ? "icon-pass" : "icon-fail"}">${verification.passed ? "&#10003;" : "&#10007;"}</span>
          <span class="verification-name">${escapeHtml(verification.name)}</span>
          <label class="checkbox-label">
            <input type="checkbox" class="confirmation-checkbox" data-id="${escapeHtml(checkboxId)}" data-command="${escapeHtml(verification.command)}" data-result="${verification.passed ? "passed" : "failed"}" ${preserveState ? "checked" : ""} onchange="updateCheckboxState(this)">
            ${t.confirm_verification_label}
          </label>
        </div>
        <div class="verification-details">
          <div class="detail-row"><span class="detail-label">${t.command_label}</span><code>${escapeHtml(verification.command)}</code></div>
          <div class="detail-row"><span class="detail-label">${t.judgment_method_label}</span><span>${escapeHtml(verification.judgment_method)}</span></div>
          <div class="detail-row"><span class="detail-label">${t.expected_outcome_label}</span><span>${escapeHtml(verification.expected_outcome)}</span></div>
          <div class="detail-row"><span class="detail-label">${t.actual_output_label}</span><pre class="output-block">${escapeHtml(verification.actual_output || t.no_output)}</pre></div>
          <div class="detail-row"><span class="detail-label">${t.conclusion_label}</span><span class="${verification.passed ? "text-pass" : "text-fail"}">${verification.passed ? t.status_pass : t.status_fail}</span></div>
        </div>
      </div>`;
  }).join("\n");

  const constraintsHtml = feature.constraints.length > 0
    ? `<ul class="constraint-list">${feature.constraints.map((constraint) => `<li>${escapeHtml(constraint)}</li>`).join("")}</ul>`
    : "";

  const keyFilesHtml = feature.key_files.map((file) =>
    `<li><code>${escapeHtml(file)}</code></li>`
  ).join("");

  return `
    <div class="feature-card" id="feature-${escapeHtml(feature.feature)}">
      <div class="feature-header" onclick="toggleSection(this)">
        <span class="status-badge ${statusClass}">${statusLabel}</span>
        <span class="feature-name">${escapeHtml(feature.feature)}</span>
        <span class="file-count">${feature.key_files.length} files</span>
        <span class="toggle-arrow">&#9660;</span>
      </div>
      <div class="feature-body collapsed">
        <div class="section-group">
          <div class="section-label">${t.what_section}</div>
          <p class="description">${escapeHtml(feature.description)}</p>
          <p class="purpose"><strong>${t.purpose_prefix}</strong>${escapeHtml(feature.purpose)}</p>
        </div>

        <div class="section-group">
          <div class="section-label">${t.how_section}</div>
          <div class="approach">${escapeHtml(feature.approach)}</div>
          <div class="section-sublabel">${t.key_files_label}</div>
          <ul class="key-files-list">${keyFilesHtml}</ul>
          ${feature.constraints.length > 0 ? `<div class="section-sublabel">${t.constraints_label}</div>${constraintsHtml}` : ""}
        </div>

        <div class="section-group">
          <div class="section-label">${t.verify_section}</div>
          ${verificationsHtml}
        </div>
      </div>
    </div>`;
}

function renderFunctionIndex(functions: FunctionReportData[], confirmationState: ConfirmationState, locale: Locale): string {
  const t = getUiLabels(locale);
  const belongsToEcl = functions.filter((functionData) => functionData.orphan_status === "belongs_to_ecl");
  const notInEcl = functions.filter((functionData) => functionData.orphan_status === "not_in_any_ecl");
  const suggestDelete = functions.filter((functionData) => functionData.orphan_status === "suggest_delete");

  let html = "";

  if (belongsToEcl.length > 0) {
    html += `<h3>${t.belongs_to_ecl_heading} (${belongsToEcl.length})</h3>`;
    html += belongsToEcl.map((functionData) => renderFunctionCard(functionData, confirmationState, locale)).join("\n");
  }

  if (notInEcl.length > 0) {
    html += `<h3>${t.not_in_ecl_heading} (${notInEcl.length})</h3>`;
    html += notInEcl.map((functionData) => renderFunctionCard(functionData, confirmationState, locale)).join("\n");
  }

  if (suggestDelete.length > 0) {
    html += `<h3>${t.suggest_delete_heading} (${suggestDelete.length})</h3>`;
    html += suggestDelete.map((functionData) => renderFunctionCard(functionData, confirmationState, locale)).join("\n");
  }

  return html;
}

function renderFunctionCard(functionData: FunctionReportData, confirmationState: ConfirmationState, locale: Locale): string {
  const t = getUiLabels(locale);
  const orphanBadge = functionData.orphan_status === "not_in_any_ecl"
    ? `<span class="badge badge-warning">not in any ECL</span>`
    : functionData.orphan_status === "suggest_delete"
    ? `<span class="badge badge-danger">${t.suggest_delete_badge}</span>`
    : "";

  const deleteCheckbox = functionData.orphan_status === "suggest_delete"
    ? (() => {
        const checkboxId = generateCheckboxId("delete_suggestion", functionData.file_path, functionData.function_name);
        const isConfirmed = confirmationState.entries[checkboxId]?.confirmed ?? false;
        return `<label class="checkbox-label"><input type="checkbox" class="confirmation-checkbox" data-id="${escapeHtml(checkboxId)}" data-command="delete_review" data-result="pending" ${isConfirmed ? "checked" : ""} onchange="updateCheckboxState(this)">${t.confirm_delete_label}</label>`;
      })()
    : "";

  const eclLinks = functionData.ecl_features.length > 0
    ? functionData.ecl_features.map((featureName) =>
        `<a href="#feature-${escapeHtml(featureName)}" class="ecl-link">${escapeHtml(featureName)}</a>`
      ).join(", ")
    : `<span class="text-dim">${t.none_label}</span>`;

  const dependenciesHtml = functionData.calls.length > 0
    ? functionData.calls.map((calledFunction) => `<span class="dep-link">${escapeHtml(calledFunction)}</span>`).join(", ")
    : `<span class="text-dim">${t.no_direct_calls}</span>`;

  const calledByHtml = functionData.called_by.length > 0
    ? functionData.called_by.map((caller) => `<span class="dep-link">${escapeHtml(caller)}</span>`).join(", ")
    : `<span class="text-dim">${t.not_called_by_any}</span>`;

  return `
    <div class="function-card" id="function-${escapeHtml(functionData.id)}">
      <div class="function-header" onclick="toggleSection(this)">
        <span class="function-name">${escapeHtml(functionData.function_name)}</span>
        ${orphanBadge}
        ${deleteCheckbox}
        <span class="function-file">${escapeHtml(functionData.file_path)}:${functionData.start_line}</span>
        <span class="toggle-arrow">&#9660;</span>
      </div>
      <div class="function-body collapsed">
        <div class="section-group">
          <div class="section-label">${t.what_section}</div>
          <p class="description">${escapeHtml(functionData.reason)}</p>
          <div class="meta-row">
            <span>${functionData.is_async ? t.async_function : t.sync_function}</span>
            <span>${functionData.is_exported ? t.exported : t.not_exported}</span>
            <span>${t.ecl_belongs_prefix}${eclLinks}</span>
          </div>
        </div>

        <div class="section-group">
          <div class="section-label">${t.how_section}</div>
          <code class="signature">${escapeHtml(functionData.signature)}</code>
          <div class="detail-row"><span class="detail-label">${t.parameters_label}</span><span>${functionData.parameters.length > 0 ? functionData.parameters.map((parameter) => `<code>${escapeHtml(parameter)}</code>`).join(", ") : t.no_parameters}</span></div>
          <div class="detail-row"><span class="detail-label">${t.return_type_label}</span><span>${functionData.return_type ? `<code>${escapeHtml(functionData.return_type)}</code>` : t.no_return_type}</span></div>
          <div class="detail-row"><span class="detail-label">${t.line_range_label}</span><span>${formatLineRange(functionData.start_line, functionData.end_line, locale)}</span></div>
        </div>

        <div class="section-group">
          <div class="section-label">${t.dependencies_section}</div>
          <div class="dep-list">${dependenciesHtml}</div>
        </div>

        <div class="section-group">
          <div class="section-label">${t.called_by_section}</div>
          <div class="dep-list">${calledByHtml}</div>
        </div>

        <div class="section-group">
          <div class="section-label">${t.verify_section}</div>
          ${functionData.test_file
            ? `<div class="test-info">
                <div class="detail-row"><span class="detail-label">${t.test_file_label}</span><code>${escapeHtml(functionData.test_file)}</code></div>
                <div class="detail-row"><span class="detail-label">${t.test_status_label}</span><span class="${functionData.test_status === "passed" ? "text-pass" : "text-fail"}">${functionData.test_status === "passed" ? t.status_pass : t.status_fail}</span></div>
                ${functionData.test_assertions.map((assertion) => `
                  <div class="assertion-row">
                    <span class="${assertion.status === "passed" ? "icon-pass" : "icon-fail"}">${assertion.status === "passed" ? "&#10003;" : "&#10007;"}</span>
                    <span>${escapeHtml(assertion.name)}</span>
                    <span class="text-dim">${escapeHtml(assertion.judgment)}</span>
                  </div>
                `).join("")}
              </div>`
            : `<span class="text-dim">${t.no_test}</span>`}
        </div>
      </div>
    </div>`;
}

function getStyles(): string {
  return `
    * { box-sizing: border-box; }
    :root {
      --background: #1a1a2e;
      --surface: #16213e;
      --surface2: #0f3460;
      --foreground: #eaeaea;
      --foreground-dim: #a0a0b0;
      --accent: #4fc3f7;
      --green: #66bb6a;
      --green-background: #1b3d1b;
      --red: #ef5350;
      --red-background: #3d1b1b;
      --yellow: #ffca28;
      --yellow-background: #3d3a1b;
      --border: #2a2a4a;
      --radius: 8px;
    }
    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: var(--background);
      color: var(--foreground);
      margin: 0;
      padding: 32px 24px;
      line-height: 1.6;
    }
    .container { max-width: 1100px; margin: 0 auto; }
    header { margin-bottom: 24px; }
    h1 { color: var(--accent); font-size: 1.6rem; margin-bottom: 4px; }
    h2 { color: var(--accent); font-size: 1.2rem; margin-top: 32px; margin-bottom: 16px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
    h3 { color: var(--foreground); font-size: 1rem; margin-top: 24px; margin-bottom: 12px; }
    .subtitle { color: var(--foreground-dim); font-size: 0.85rem; margin: 0; }
    .project-description { color: var(--foreground-dim); font-size: 0.9rem; margin-top: 8px; }
    .summary-bar {
      display: flex; gap: 24px; padding: 16px 20px;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius); margin-bottom: 16px; flex-wrap: wrap;
    }
    .summary-stat { font-size: 0.85rem; color: var(--foreground-dim); }
    .summary-stat strong { color: var(--accent); font-size: 1.2rem; margin-right: 2px; }
    .toolbar { display: flex; gap: 8px; margin-bottom: 24px; }
    .toolbar button {
      padding: 6px 14px; border: 1px solid var(--border); border-radius: 4px;
      background: var(--surface); color: var(--foreground); cursor: pointer;
      font-size: 0.8rem;
    }
    .toolbar button:hover { background: var(--surface2); }
    .feature-card, .function-card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius); margin-bottom: 12px; overflow: hidden;
    }
    .feature-header, .function-header {
      display: flex; align-items: center; gap: 12px;
      padding: 14px 18px; cursor: pointer; user-select: none;
    }
    .feature-header:hover, .function-header:hover { background: var(--surface2); }
    .status-badge {
      font-size: 0.7rem; padding: 2px 10px; border-radius: 10px;
      font-weight: 600;
    }
    .status-pass { background: var(--green-background); color: var(--green); }
    .status-fail { background: var(--red-background); color: var(--red); }
    .status-partial { background: var(--yellow-background); color: var(--yellow); }
    .feature-name, .function-name {
      font-size: 0.95rem; font-weight: 600; color: #fff;
      font-family: 'Cascadia Code', 'Fira Code', monospace;
    }
    .function-file { font-size: 0.75rem; color: var(--foreground-dim); margin-left: auto; }
    .file-count { font-size: 0.75rem; color: var(--foreground-dim); }
    .toggle-arrow { color: var(--accent); font-size: 0.7rem; margin-left: auto; transition: transform 0.2s; }
    .feature-body, .function-body { padding: 0 18px 16px 18px; }
    .collapsed { display: none; }
    .section-group { margin-top: 16px; }
    .section-label {
      font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px;
      color: var(--accent); font-weight: 600; margin-bottom: 6px;
    }
    .section-sublabel { font-size: 0.7rem; color: var(--foreground-dim); font-weight: 600; margin-top: 10px; margin-bottom: 4px; }
    .description { font-size: 0.85rem; color: var(--foreground); margin: 4px 0; }
    .purpose { font-size: 0.8rem; color: var(--foreground-dim); margin: 4px 0; }
    .approach {
      font-size: 0.8rem; padding: 8px 12px;
      background: var(--surface2); border-radius: 4px; margin-bottom: 8px;
    }
    .key-files-list { list-style: none; padding: 0; margin: 4px 0; }
    .key-files-list li { font-size: 0.8rem; padding: 2px 0; }
    .constraint-list { list-style: none; padding: 0; margin: 4px 0; }
    .constraint-list li { font-size: 0.8rem; color: var(--foreground-dim); padding: 2px 0; }
    .constraint-list li::before { content: "\\2022"; color: var(--accent); margin-right: 8px; }
    .verification-item { margin-top: 10px; padding: 10px; background: var(--surface2); border-radius: 4px; }
    .verification-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .verification-icon { font-size: 1rem; }
    .icon-pass { color: var(--green); }
    .icon-fail { color: var(--red); }
    .verification-name { font-size: 0.85rem; font-weight: 500; }
    .verification-details { padding-left: 24px; }
    .detail-row { display: flex; gap: 8px; padding: 3px 0; font-size: 0.8rem; align-items: baseline; }
    .detail-label { color: var(--foreground-dim); min-width: 80px; flex-shrink: 0; }
    .output-block {
      font-family: 'Cascadia Code', monospace; font-size: 0.75rem;
      background: var(--background); padding: 6px 10px; border-radius: 4px;
      max-height: 120px; overflow-y: auto; white-space: pre-wrap; margin: 2px 0;
    }
    .text-pass { color: var(--green); }
    .text-fail { color: var(--red); }
    .text-dim { color: var(--foreground-dim); }
    .checkbox-label {
      display: flex; align-items: center; gap: 4px;
      font-size: 0.75rem; color: var(--foreground-dim); margin-left: auto; cursor: pointer;
    }
    .confirmation-checkbox { cursor: pointer; }
    .badge {
      font-size: 0.65rem; padding: 2px 8px; border-radius: 10px; font-weight: 600;
    }
    .badge-warning { background: var(--yellow-background); color: var(--yellow); }
    .badge-danger { background: var(--red-background); color: var(--red); }
    .meta-row { display: flex; gap: 16px; font-size: 0.8rem; color: var(--foreground-dim); margin-top: 6px; }
    .signature {
      display: block; font-size: 0.8rem; padding: 8px 12px;
      background: var(--background); border-radius: 4px; margin: 6px 0;
    }
    .dep-list { font-size: 0.8rem; color: var(--foreground); }
    .dep-link { color: var(--accent); cursor: pointer; margin-right: 8px; }
    .ecl-link { color: var(--accent); text-decoration: none; }
    .ecl-link:hover { text-decoration: underline; }
    .test-info { margin-top: 6px; }
    .assertion-row { display: flex; align-items: center; gap: 8px; font-size: 0.8rem; padding: 2px 0; }
    .empty-section { color: var(--foreground-dim); font-size: 0.85rem; padding: 16px; text-align: center; }
  `;
}

function getScript(initialState: ConfirmationState, locale: Locale): string {
  const t = getUiLabels(locale);
  return `
    var confirmationState = ${JSON.stringify(initialState)};

    function toggleSection(header) {
      var body = header.nextElementSibling;
      body.classList.toggle('collapsed');
      var arrow = header.querySelector('.toggle-arrow');
      if (arrow) {
        arrow.style.transform = body.classList.contains('collapsed') ? '' : 'rotate(180deg)';
      }
    }

    function updateCheckboxState(checkbox) {
      var id = checkbox.dataset.id;
      var command = checkbox.dataset.command;
      var result = checkbox.dataset.result;

      if (!confirmationState.entries) confirmationState.entries = {};

      confirmationState.entries[id] = {
        id: id,
        confirmed: checkbox.checked,
        last_command: command,
        last_result: result,
        last_updated: new Date().toISOString()
      };

      updateCheckboxProgress();
    }

    function updateCheckboxProgress() {
      var checkboxes = document.querySelectorAll('.confirmation-checkbox');
      var total = checkboxes.length;
      var confirmed = 0;
      checkboxes.forEach(function(checkbox) {
        if (checkbox.checked) confirmed++;
      });
      document.getElementById('checkbox-confirmed').textContent = confirmed;
      document.getElementById('checkbox-total').textContent = total;
    }

    function exportConfirmation() {
      confirmationState.exported_at = new Date().toISOString();
      var blob = new Blob([JSON.stringify(confirmationState, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = 'overview-confirmation.json';
      link.click();
      URL.revokeObjectURL(url);
    }

    function importConfirmation() {
      document.getElementById('import-file-input').click();
    }

    function handleImportFile(event) {
      var file = event.target.files[0];
      if (!file) return;

      var reader = new FileReader();
      reader.onload = function(e) {
        try {
          var imported = JSON.parse(e.target.result);
          confirmationState = imported;

          var checkboxes = document.querySelectorAll('.confirmation-checkbox');
          checkboxes.forEach(function(checkbox) {
            var id = checkbox.dataset.id;
            var entry = confirmationState.entries[id];
            if (entry && entry.confirmed) {
              var currentCommand = checkbox.dataset.command;
              var currentResult = checkbox.dataset.result;
              if (entry.last_command === currentCommand && entry.last_result === currentResult) {
                checkbox.checked = true;
              }
            }
          });

          updateCheckboxProgress();
          alert('${t.import_success_alert}');
        } catch (error) {
          alert('${t.import_fail_alert}');
        }
      };
      reader.readAsText(file);
    }

    document.addEventListener('DOMContentLoaded', updateCheckboxProgress);
  `;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const IGNORED_DIRECTORIES = new Set([
  "node_modules", ".git", ".devcompanion", "dist", "build",
  "__pycache__", ".venv", "coverage", ".next", "archive",
]);

function collectSourceFiles(directory: string, extensions: Set<string>): string[] {
  const files: string[] = [];

  function walk(current: string): void {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = resolve(current, entry.name);

      if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) {
        walk(fullPath);
      } else if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  }

  walk(directory);
  return files;
}

main().catch(console.error);
