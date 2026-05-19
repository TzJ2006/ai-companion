#!/usr/bin/env npx tsx
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { detectProject, listProjectDirectories } from "./lib/project-detector.ts";
import { initDevcompanion } from "./lib/init-devcompanion.ts";
import { inferFeaturesFromStructure, writeInferredEcl } from "./lib/ecl-inferrer.ts";

const SCRIPT_ROOT = resolve(import.meta.dirname);
const GITHUB_ROOT = resolve(import.meta.dirname, "../..");
const GENERATE_SCRIPT = resolve(SCRIPT_ROOT, "generate-overview.ts");

interface BatchResult {
  project: string;
  status: "success" | "skipped" | "error";
  reason?: string;
  duration_ms?: number;
}

async function main(): Promise<void> {
  const targetRoot = process.argv[2] ?? GITHUB_ROOT;
  const resolvedRoot = resolve(targetRoot);
  const dryRun = process.argv.includes("--dry-run");

  console.log("=== Batch Overview Generation ===");
  console.log(`  Scanning: ${resolvedRoot}`);
  console.log();

  const projectPaths = listProjectDirectories(resolvedRoot);
  const results: BatchResult[] = [];

  console.log(`  Found ${projectPaths.length} directories to evaluate\n`);

  for (const projectPath of projectPaths) {
    const detection = detectProject(projectPath);

    if (detection.skip_reason) {
      console.log(`  [SKIP] ${detection.name}: ${detection.skip_reason}`);
      results.push({ project: detection.name, status: "skipped", reason: detection.skip_reason });
      continue;
    }

    if (!detection.has_code) {
      console.log(`  [SKIP] ${detection.name}: 无源代码`);
      results.push({ project: detection.name, status: "skipped", reason: "无源代码" });
      continue;
    }

    console.log(`  [INIT] ${detection.name} (${detection.language})`);

    const initResult = initDevcompanion(projectPath);
    if (initResult.created_directories.length > 0) {
      console.log(`         Created: ${initResult.created_directories.join(", ")}`);
    }

    if (!detection.has_ecl) {
      const features = inferFeaturesFromStructure(projectPath, detection.language);
      if (features.length > 0) {
        const eclPath = writeInferredEcl(projectPath, detection.name, detection.description, features);
        console.log(`         Inferred ${features.length} features → ${eclPath}`);
      }
    }

    const startTime = Date.now();
    try {
      execSync(
        `npx tsx "${GENERATE_SCRIPT}" --target "${projectPath}"${dryRun ? " --dry-run" : ""}`,
        {
          cwd: resolve(SCRIPT_ROOT, ".."),
          stdio: "pipe",
          timeout: 120000,
        }
      );
      const duration = Date.now() - startTime;
      console.log(`  [DONE] ${detection.name} (${duration}ms)`);
      results.push({ project: detection.name, status: "success", duration_ms: duration });
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  [FAIL] ${detection.name}: ${message.slice(0, 100)}`);
      results.push({ project: detection.name, status: "error", reason: message.slice(0, 200), duration_ms: duration });
    }

    console.log();
  }

  console.log("\n=== Summary ===");
  const successCount = results.filter((r) => r.status === "success").length;
  const skipCount = results.filter((r) => r.status === "skipped").length;
  const errorCount = results.filter((r) => r.status === "error").length;
  console.log(`  Success: ${successCount}`);
  console.log(`  Skipped: ${skipCount}`);
  console.log(`  Errors:  ${errorCount}`);

  if (errorCount > 0) {
    console.log("\n  Failed projects:");
    for (const result of results.filter((r) => r.status === "error")) {
      console.log(`    - ${result.project}: ${result.reason}`);
    }
  }
}

main().catch(console.error);
