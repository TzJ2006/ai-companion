import type { FeatureEntry } from "./ecl-parser.ts";
import type { CallGraph, CallGraphEntry } from "../../packages/ast/src/call-graph.ts";

export interface FunctionAttribution {
  function_name: string;
  class_name: string | null;
  file_path: string;
  start_line: number;
  end_line: number;
  ecl_features: string[];
  is_exported: boolean;
  is_entry_file: boolean;
  is_test_helper: boolean;
  calls: string[];
  called_by: string[];
  orphan_status: "belongs_to_ecl" | "not_in_any_ecl" | "suggest_delete";
}

export function buildAttributionMap(
  callGraph: CallGraph,
  features: FeatureEntry[],
  exportedFunctions: Set<string>,
  entryFiles: Set<string>,
  testHelperFiles: Set<string>
): FunctionAttribution[] {
  const attributions: FunctionAttribution[] = [];

  for (const entry of callGraph.entries) {
    const functionId = formatId(entry.file_path, entry.class_name, entry.function_name);
    const eclFeatures = findBelongingFeatures(entry, features);
    const calledByList = callGraph.reverse_index[functionId] ?? [];
    const isExported = exportedFunctions.has(functionId);
    const isEntryFile = entryFiles.has(entry.file_path);
    const isTestHelper = testHelperFiles.has(entry.file_path);

    let orphanStatus: FunctionAttribution["orphan_status"];
    if (eclFeatures.length > 0) {
      orphanStatus = "belongs_to_ecl";
    } else if (
      calledByList.length === 0 &&
      !isExported &&
      !isEntryFile &&
      !isTestHelper
    ) {
      orphanStatus = "suggest_delete";
    } else {
      orphanStatus = "not_in_any_ecl";
    }

    attributions.push({
      function_name: entry.function_name,
      class_name: entry.class_name,
      file_path: entry.file_path,
      start_line: entry.start_line,
      end_line: entry.end_line,
      ecl_features: eclFeatures,
      is_exported: isExported,
      is_entry_file: isEntryFile,
      is_test_helper: isTestHelper,
      calls: entry.calls,
      called_by: calledByList,
      orphan_status: orphanStatus,
    });
  }

  return attributions;
}

function findBelongingFeatures(entry: CallGraphEntry, features: FeatureEntry[]): string[] {
  const belonging: string[] = [];
  const normalizedFilePath = entry.file_path.replace(/\\/g, "/");

  for (const feature of features) {
    for (const keyFile of feature.implementation.key_files) {
      const normalizedKeyFile = keyFile.replace(/\\/g, "/");
      if (normalizedFilePath === normalizedKeyFile || normalizedFilePath.endsWith(normalizedKeyFile)) {
        belonging.push(feature.feature);
        break;
      }
    }
  }

  return belonging;
}

export function detectExportedFunctions(
  callGraphEntries: CallGraphEntry[],
  fileExports: Map<string, Set<string>>
): Set<string> {
  const exported = new Set<string>();

  for (const entry of callGraphEntries) {
    const fileExportSet = fileExports.get(entry.file_path);
    if (fileExportSet && fileExportSet.has(entry.function_name)) {
      exported.add(formatId(entry.file_path, entry.class_name, entry.function_name));
    }
  }

  return exported;
}

export function detectEntryFiles(files: string[]): Set<string> {
  const entryPatterns = [
    /index\.(ts|tsx|js|jsx)$/,
    /main\.(ts|tsx|js|jsx)$/,
    /cli\.(ts|tsx|js|jsx)$/,
    /bin\//,
  ];

  const entryFiles = new Set<string>();
  for (const file of files) {
    const normalized = file.replace(/\\/g, "/");
    if (entryPatterns.some((pattern) => pattern.test(normalized))) {
      entryFiles.add(file);
    }
  }

  return entryFiles;
}

export function detectTestHelperFiles(files: string[]): Set<string> {
  const testPatterns = [
    /\.test\.(ts|tsx|js|jsx)$/,
    /\.spec\.(ts|tsx|js|jsx)$/,
    /test[_-]helper/i,
    /test[_-]util/i,
    /fixtures?\//i,
    /mocks?\//i,
    /__tests__\//,
    /\.devcompanion\/tests\//,
  ];

  const testFiles = new Set<string>();
  for (const file of files) {
    const normalized = file.replace(/\\/g, "/");
    if (testPatterns.some((pattern) => pattern.test(normalized))) {
      testFiles.add(file);
    }
  }

  return testFiles;
}

function formatId(filePath: string, className: string | null, functionName: string): string {
  if (className) {
    return `${filePath}::${className}.${functionName}`;
  }
  return `${filePath}::${functionName}`;
}
