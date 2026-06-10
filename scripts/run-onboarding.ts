#!/usr/bin/env npx tsx
import { resolve } from "node:path";
import { runOnboardingAnalysis } from "./lib/onboarding-pipeline.ts";
import { execSync } from "node:child_process";

const SCRIPT_ROOT = resolve(import.meta.dirname);
const GENERATE_SCRIPT = resolve(SCRIPT_ROOT, "generate-overview.ts");

const projectPath = process.argv[2];
if (!projectPath) {
  console.error("Usage: npx tsx scripts/run-onboarding.ts <project-path>");
  process.exit(1);
}

const resolved = resolve(projectPath);

async function main(): Promise<void> {
  const startTime = Date.now();

  function elapsed(): string {
    return `${Math.round((Date.now() - startTime) / 1000)}s`;
  }

  const result = await runOnboardingAnalysis(resolved, {
    concurrency: 4,
    onProgress: (stage, done, total, detail) => {
      console.log(`[${elapsed()}] ${stage} ${done}/${total} — ${detail}`);
    },
  });

  console.log(
    `\n=== ${result.project_name} COMPLETE ===\n` +
    `Functions: ${result.functions_analyzed}, Features: ${result.features_inferred}, ` +
    `Tests: ${result.tests_generated?.generated.length ?? 0}, Duration: ${(result.duration_ms / 1000).toFixed(1)}s\n`
  );

  try {
    execSync(`npx tsx "${GENERATE_SCRIPT}" --target "${resolved}"`, {
      cwd: resolve(SCRIPT_ROOT, ".."),
      stdio: "inherit",
      timeout: 120000,
    });
    console.log(`Overview regenerated for ${result.project_name}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to regenerate overview: ${message}`);
  }
}

main().catch(console.error);
