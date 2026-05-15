#!/usr/bin/env npx tsx
/**
 * Generate the onboard report HTML with function reasons and test results.
 * Reads .devcompanion/report-data.json (from collect-report-data.ts) and renders HTML.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve, relative, extname } from "node:path";
import { readdir } from "node:fs/promises";
import { parseFileAuto, getSupportedExtensions, computeFunctionIdentity } from "../packages/ast/src/index.ts";
import { renderOnboardHtml } from "../packages/render/src/onboard-renderer.ts";
import type { ParsedModule } from "../packages/ast/src/types.ts";
import type { ProjectIndex, FunctionIndexEntry } from "../packages/history/src/types.ts";
import type { ReportData } from "../packages/render/src/onboard-renderer.ts";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");

const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".devcompanion", "dist", "build",
  "__pycache__", ".venv", "coverage", ".next",
]);

async function collectFiles(dir: string, extensions: Set<string>): Promise<string[]> {
  const files: string[] = [];
  async function walk(current: string) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = resolve(current, entry.name);
      if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name)) {
        await walk(full);
      } else if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) {
        files.push(full);
      }
    }
  }
  await walk(dir);
  return files;
}

async function main() {
  // Load report data if available
  let reportData: ReportData | undefined;
  const reportDataPath = resolve(PROJECT_ROOT, ".devcompanion/report-data.json");
  try {
    const raw = await readFile(reportDataPath, "utf-8");
    reportData = JSON.parse(raw);
    console.log(`Loaded report data: ${reportData!.total_functions} functions, ${reportData!.tests_passed}/${reportData!.total_tests} tests passed`);
  } catch {
    console.log("No report-data.json found. Run scripts/collect-report-data.ts first for full report.");
    console.log("Generating basic report without reasons/test results...");
  }

  // Scan and parse project
  const extensions = new Set(getSupportedExtensions());
  const files = await collectFiles(PROJECT_ROOT, extensions);
  console.log(`Scanning ${files.length} source files...`);

  const modules: ParsedModule[] = [];
  const functionIndex: Record<string, FunctionIndexEntry> = {};

  for (const file of files) {
    try {
      const parsed = await parseFileAuto(file);
      parsed.file_path = relative(PROJECT_ROOT, file);
      modules.push(parsed);

      for (const fn of parsed.functions) {
        const identity = computeFunctionIdentity(parsed.file_path, fn);
        functionIndex[identity.hash] = {
          hash: identity.hash,
          file_path: parsed.file_path,
          function_name: fn.name,
          class_name: fn.class_name,
          last_modified: new Date().toISOString(),
          change_count: 0,
          test_status: "pending",
        };
      }
      for (const cls of parsed.classes) {
        for (const method of cls.methods) {
          const identity = computeFunctionIdentity(parsed.file_path, method);
          functionIndex[identity.hash] = {
            hash: identity.hash,
            file_path: parsed.file_path,
            function_name: method.name,
            class_name: method.class_name,
            last_modified: new Date().toISOString(),
            change_count: 0,
            test_status: "pending",
          };
        }
      }
    } catch (e) {
      console.warn(`  Skip: ${relative(PROJECT_ROOT, file)} (${(e as Error).message})`);
    }
  }

  const index: ProjectIndex = {
    project_root: PROJECT_ROOT,
    last_updated: new Date().toISOString(),
    total_sessions: 0,
    total_changes: 0,
    function_index: functionIndex,
  };

  const html = renderOnboardHtml(index, {
    title: "AI Dev Companion — Onboarding Report",
    project_root: PROJECT_ROOT,
    modules,
    reportData,
  });

  const outPath = resolve(PROJECT_ROOT, "onboard-report.html");
  await writeFile(outPath, html);
  console.log(`\nReport written to: ${outPath}`);
}

main().catch(console.error);
