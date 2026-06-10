#!/usr/bin/env npx tsx
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { installAgentConfig } from "./lib/install-agent-config.ts";
import { loadRegistry, saveRegistry, addTarget, getRegistryPath } from "./lib/registry.ts";

const args = process.argv.slice(2);

function printUsage(): void {
  console.log(`Usage: npx tsx scripts/update.ts [options]

Rebuild AI Dev Companion and refresh all registered target projects.
Run this after pulling new changes to ai-companion.

Steps performed:
  1. npm install (if needed)
  2. npm run build (recompile TypeScript)
  3. Re-install config into all registered targets

Options:
  --skip-build     Skip npm install and build steps (only refresh targets)
  --target <path>  Only update a specific target (not all)
  --help, -h       Show this help

Examples:
  npx tsx scripts/update.ts
  npx tsx scripts/update.ts --skip-build
  npx tsx scripts/update.ts --target /path/to/my-project
`);
}

if (args.includes("--help") || args.includes("-h")) {
  printUsage();
  process.exit(0);
}

const skipBuild = args.includes("--skip-build");
const targetIndex = args.indexOf("--target");
const singleTarget = targetIndex >= 0 ? resolve(args[targetIndex + 1]) : null;

const aidevRoot = resolve(import.meta.dirname, "..");

const registry = loadRegistry();
if (registry.targets.length === 0 && !singleTarget) {
  console.log("No targets registered. Use 'npx tsx scripts/install.ts <path>' to install first.");
  console.log(`Registry location: ${getRegistryPath()}`);
  process.exit(0);
}

if (!skipBuild) {
  console.log("Step 1: Installing dependencies...");
  try {
    execSync("npm install", { cwd: aidevRoot, stdio: "inherit" });
  } catch {
    console.error("npm install failed. Fix errors and retry.");
    process.exit(1);
  }

  console.log("\nStep 2: Building...");
  try {
    execSync("npm run build", { cwd: aidevRoot, stdio: "inherit" });
  } catch {
    console.error("Build failed. Fix errors and retry.");
    process.exit(1);
  }
  console.log();
}

const targets = singleTarget
  ? registry.targets.filter((t) => resolve(t.path) === singleTarget)
  : registry.targets;

if (targets.length === 0) {
  if (singleTarget) {
    console.error(`Target not found in registry: ${singleTarget}`);
    console.log("Registered targets:");
    for (const t of registry.targets) {
      console.log(`  - ${t.path}`);
    }
  }
  process.exit(1);
}

console.log(`Step 3: Refreshing ${targets.length} target(s)...\n`);

let successCount = 0;
let failCount = 0;

for (const target of targets) {
  const targetPath = resolve(target.path);
  if (!existsSync(targetPath)) {
    console.log(`  SKIP: ${targetPath} (directory no longer exists)`);
    failCount++;
    continue;
  }

  try {
    installAgentConfig({
      targetPath,
      aidevRoot,
      enforce: target.enforce,
      includeCommands: target.commands,
    });
    saveRegistry(addTarget(registry, targetPath, target.enforce, target.commands));
    console.log(`  OK: ${targetPath}`);
    successCount++;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  FAIL: ${targetPath} — ${message}`);
    failCount++;
  }
}

registry.aidev_root = aidevRoot;
saveRegistry(registry);

console.log(`\nUpdate complete: ${successCount} succeeded, ${failCount} failed.`);
