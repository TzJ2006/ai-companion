#!/usr/bin/env npx tsx
/**
 * Collect test results + LLM-generated function reasons for the onboard report.
 * Outputs .devcompanion/report-data.json
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { parseFileAuto, getSupportedExtensions } from "../packages/ast/src/index.ts";
import type { FunctionSignature, ParsedModule } from "../packages/ast/src/types.ts";

const exec = promisify(execFile);
const PROJECT_ROOT = resolve(import.meta.dirname, "..");

interface TestResult {
  test_file: string;
  suite_status: "passed" | "failed";
  assertions: Array<{
    name: string;
    status: "passed" | "failed";
    failure_message?: string;
  }>;
  error_message?: string;
}

interface FunctionReason {
  file_path: string;
  function_name: string;
  class_name: string | null;
  signature: string;
  reason: string;
  reason_source: "llm-inferred" | "user-provided" | "heuristic";
  test_file: string | null;
  test_status: "passed" | "failed" | "no-test";
  test_details: Array<{ name: string; status: string; reason?: string }>;
}

interface ReportData {
  generated_at: string;
  total_functions: number;
  total_tests: number;
  tests_passed: number;
  tests_failed: number;
  functions: FunctionReason[];
}

async function collectTestResults(): Promise<Map<string, TestResult>> {
  console.log("Running tests...");
  const results = new Map<string, TestResult>();

  try {
    const { stdout } = await exec("npx", ["vitest", "run", ".devcompanion/tests/", "--reporter=json"], {
      cwd: PROJECT_ROOT,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120000,
    });

    const data = JSON.parse(stdout);

    for (const suite of data.testResults) {
      const fileName = suite.name.split("/").pop()!;
      const assertions = (suite.assertionResults || []).map((a: any) => ({
        name: a.fullName || a.title || "unknown",
        status: a.status === "passed" ? "passed" : "failed",
        failure_message: a.failureMessages?.[0]?.split("\n")[0],
      }));

      results.set(fileName, {
        test_file: fileName,
        suite_status: suite.status === "passed" ? "passed" : "failed",
        assertions,
        error_message: suite.message?.split("\n")[0],
      });
    }
  } catch (e: any) {
    if (e.stdout) {
      try {
        const data = JSON.parse(e.stdout);
        for (const suite of data.testResults) {
          const fileName = suite.name.split("/").pop()!;
          const assertions = (suite.assertionResults || []).map((a: any) => ({
            name: a.fullName || a.title || "unknown",
            status: a.status === "passed" ? "passed" : "failed",
            failure_message: a.failureMessages?.[0]?.split("\n")[0],
          }));
          results.set(fileName, {
            test_file: fileName,
            suite_status: suite.status === "passed" ? "passed" : "failed",
            assertions,
            error_message: suite.message?.split("\n")[0],
          });
        }
      } catch {
        console.warn("Failed to parse test output");
      }
    }
  }

  console.log(`  Collected results for ${results.size} test suites`);
  return results;
}

async function generateFunctionReason(fn: FunctionSignature, filePath: string): Promise<string> {
  const params = fn.params.map(p => `${p.name}: ${p.type ?? "any"}`).join(", ");
  const sig = `${fn.is_async ? "async " : ""}${fn.class_name ? fn.class_name + "." : ""}${fn.name}(${params})${fn.return_type ? ": " + fn.return_type : ""}`;

  const prompt = `Given this function signature from file "${filePath}":
${sig}
${fn.docstring ? `Docstring: ${fn.docstring}` : ""}

In ONE sentence (max 20 words), explain what this function likely does. Be specific and technical. Output ONLY the sentence, no quotes, no period at end.`;

  try {
    const { stdout } = await exec("claude", ["-p", prompt], {
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
    const line = stdout.trim().split("\n")[0].replace(/^["']|["']$/g, "").replace(/\.$/, "");
    return line || `Processes ${fn.params.length > 0 ? fn.params[0].name : "data"} and returns ${fn.return_type ?? "result"}`;
  } catch {
    // Fallback: generate heuristic reason
    return generateHeuristicReason(fn);
  }
}

function generateHeuristicReason(fn: FunctionSignature): string {
  const name = fn.name;
  const params = fn.params.map(p => p.name).join(", ");

  if (name.startsWith("get") || name.startsWith("fetch")) {
    const what = name.replace(/^(get|fetch)/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase();
    return `Retrieves ${what || "data"} based on ${params || "current state"}`;
  }
  if (name.startsWith("set") || name.startsWith("update")) {
    const what = name.replace(/^(set|update)/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase();
    return `Updates ${what || "value"} with provided ${params || "data"}`;
  }
  if (name.startsWith("parse")) {
    return `Parses ${params || "input"} into structured ${fn.return_type ?? "data"}`;
  }
  if (name.startsWith("render")) {
    return `Renders ${params || "content"} into ${fn.return_type ?? "output format"}`;
  }
  if (name.startsWith("init") || name.startsWith("create")) {
    return `Initializes ${(fn.class_name ?? name.replace(/^(init|create)/, "").toLowerCase()) || "instance"}`;
  }
  if (name.startsWith("is") || name.startsWith("has") || name.startsWith("can")) {
    return `Checks whether ${name.replace(/^(is|has|can)/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase()}`;
  }
  if (name.startsWith("compute") || name.startsWith("calculate")) {
    return `Computes ${name.replace(/^(compute|calculate)/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase()} from ${params || "inputs"}`;
  }
  if (name.startsWith("write") || name.startsWith("save")) {
    return `Persists ${params || "data"} to storage`;
  }
  if (name.startsWith("read") || name.startsWith("load")) {
    return `Reads ${fn.return_type ?? "data"} from ${params || "source"}`;
  }
  if (fn.is_method && fn.class_name) {
    return `${fn.class_name} method that processes ${params || "request"}`;
  }
  return `Handles ${name.replace(/([A-Z])/g, " $1").trim().toLowerCase()} operation`;
}

function getTestFileName(filePath: string, fnName: string, className: string | null): string {
  const fileBase = filePath.split("/").pop()?.replace(/\.(ts|tsx|py)$/, "") ?? "";
  const module = fileBase.split("/").pop() ?? fileBase;
  if (className) {
    return `test_${module}_${className}.test.ts`;
  }
  return `test_${module}_${fnName}.test.ts`;
}

async function main() {
  const testResults = await collectTestResults();

  // Scan project for all functions
  console.log("Scanning project...");
  const extensions = new Set(getSupportedExtensions());
  const { readdir } = await import("node:fs/promises");
  const { extname } = await import("node:path");

  const IGNORED_DIRS = new Set([
    "node_modules", ".git", ".devcompanion", "dist", "build",
    "__pycache__", ".venv", "coverage", ".next",
  ]);

  async function collectFiles(dir: string): Promise<string[]> {
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

  const files = await collectFiles(PROJECT_ROOT);
  console.log(`  Found ${files.length} source files`);

  const allFunctions: Array<{ fn: FunctionSignature; filePath: string }> = [];

  for (const file of files) {
    try {
      const parsed = await parseFileAuto(file);
      const relPath = relative(PROJECT_ROOT, file);
      for (const fn of parsed.functions) {
        allFunctions.push({ fn, filePath: relPath });
      }
      for (const cls of parsed.classes) {
        for (const method of cls.methods) {
          allFunctions.push({ fn: method, filePath: relPath });
        }
      }
    } catch {
      // skip unparseable files
    }
  }

  console.log(`  Found ${allFunctions.length} functions`);
  console.log("Generating reasons with LLM...");

  const functions: FunctionReason[] = [];
  let llmCalls = 0;

  for (const { fn, filePath } of allFunctions) {
    const testFile = getTestFileName(filePath, fn.name, fn.class_name);
    const testResult = testResults.get(testFile);

    const params = fn.params.map(p => `${p.name}: ${p.type ?? "any"}`).join(", ");
    const signature = `${fn.is_async ? "async " : ""}${fn.class_name ? fn.class_name + "." : ""}${fn.name}(${params})${fn.return_type ? ": " + fn.return_type : ""}`;

    // Generate reason: use LLM if --llm flag, otherwise heuristic
    const useLlm = process.argv.includes("--llm");
    let reason: string;
    let reason_source: "llm-inferred" | "user-provided" | "heuristic";
    if (useLlm && llmCalls < 20) {
      reason = await generateFunctionReason(fn, filePath);
      reason_source = "llm-inferred";
      llmCalls++;
      if (llmCalls % 10 === 0) console.log(`  Generated ${llmCalls} reasons...`);
    } else {
      reason = generateHeuristicReason(fn);
      reason_source = useLlm ? "heuristic" : "heuristic";
    }

    const td: Array<{ name: string; status: string; reason?: string }> = [];
    if (testResult && testResult.assertions) {
      for (let i = 0; i < testResult.assertions.length; i++) {
        const a = testResult.assertions[i];
        td.push({ name: a.name, status: a.status, reason: a.failure_message });
      }
    }

    functions.push({
      file_path: filePath,
      function_name: fn.name,
      class_name: fn.class_name,
      signature: signature,
      reason: reason,
      reason_source: reason_source,
      test_file: testResult ? testFile : null,
      test_status: testResult ? testResult.suite_status : "no-test",
      test_details: td,
    });
  }

  const report: ReportData = {
    generated_at: new Date().toISOString(),
    total_functions: functions.length,
    total_tests: testResults.size,
    tests_passed: [...testResults.values()].filter(t => t.suite_status === "passed").length,
    tests_failed: [...testResults.values()].filter(t => t.suite_status === "failed").length,
    functions,
  };

  const outPath = resolve(PROJECT_ROOT, ".devcompanion/report-data.json");
  await writeFile(outPath, JSON.stringify(report, null, 2));
  console.log(`\nReport data written to: ${outPath}`);
  console.log(`  Functions: ${report.total_functions}`);
  console.log(`  Tests passed: ${report.tests_passed}/${report.total_tests}`);
}

main().catch(console.error);
