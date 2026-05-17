import { Command } from "commander";
import { resolve, relative, extname } from "node:path";
import { readdir, writeFile, mkdir } from "node:fs/promises";
import { parseFileAuto, getSupportedExtensions, computeFunctionIdentity } from "@aidev/ast";
import type { FunctionSignature, ParsedModule } from "@aidev/ast";
import { generateTestSkeleton } from "@aidev/core";
import type { TsTestGenConfig } from "@aidev/core";
import { HistoryStore } from "@aidev/history";
import type { ProjectIndex, FunctionIndexEntry } from "@aidev/history";

interface OnboardResult {
  files_scanned: number;
  functions_found: number;
  classes_found: number;
  index_path: string;
}

const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".devcompanion", "dist", "build",
  "__pycache__", ".venv", "venv", ".tox", ".mypy_cache",
  "coverage", ".next", ".nuxt",
]);

async function collectFiles(dir: string, extensions: Set<string>): Promise<string[]> {
  const files: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".") continue;
      const fullPath = resolve(current, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          await walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (extensions.has(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  await walk(dir);
  return files;
}

export const onboardCommand = new Command("onboard")
  .description("Scan project and build a full function index with test skeletons (onboarding)")
  .option("-p, --project <path>", "Project root path", ".")
  .option("--json", "Output results as JSON")
  .option("--no-tests", "Skip test skeleton generation")
  .option("--test-dir <dir>", "Directory for generated tests", ".devcompanion/tests")
  .option("--llm-enhance", "Use LLM to enhance test assertions (requires claude CLI)")
  .action(async (opts) => {
    const projectRoot = resolve(opts.project);
    const store = new HistoryStore(projectRoot);
    await store.init();

    const supportedExts = new Set(getSupportedExtensions());
    console.log(`Scanning ${projectRoot} for: ${[...supportedExts].join(", ")}`);

    const files = await collectFiles(projectRoot, supportedExts);
    console.log(`Found ${files.length} source files`);

    let totalFunctions = 0;
    let totalClasses = 0;
    const functionIndex: Record<string, FunctionIndexEntry> = {};
    const fileResults: Array<{ file: string; module: ParsedModule }> = [];

    for (const file of files) {
      try {
        const parsed = await parseFileAuto(file);
        const relPath = relative(projectRoot, file);
        parsed.file_path = relPath;
        fileResults.push({ file: relPath, module: parsed });

        const allFunctions: Array<{ fn: FunctionSignature; filePath: string }> = [];

        for (const fn of parsed.functions) {
          allFunctions.push({ fn, filePath: relPath });
        }

        for (const cls of parsed.classes) {
          totalClasses++;
          for (const method of cls.methods) {
            allFunctions.push({ fn: method, filePath: relPath });
          }
        }

        for (const { fn, filePath } of allFunctions) {
          totalFunctions++;
          const identity = computeFunctionIdentity(filePath, fn);
          functionIndex[identity.hash] = {
            hash: identity.hash,
            file_path: filePath,
            function_name: fn.name,
            class_name: fn.class_name,
            last_modified: new Date().toISOString(),
            change_count: 0,
            test_status: "pending",
          };
        }
      } catch (e) {
        console.warn(`  Warning: Failed to parse ${relative(projectRoot, file)}: ${(e as Error).message}`);
      }
    }

    const index: ProjectIndex = {
      project_root: projectRoot,
      last_updated: new Date().toISOString(),
      total_sessions: 0,
      total_changes: 0,
      function_index: functionIndex,
    };

    await store.writeIndex(index);

    const result: OnboardResult = {
      files_scanned: files.length,
      functions_found: totalFunctions,
      classes_found: totalClasses,
      index_path: resolve(projectRoot, ".devcompanion/index.json"),
    };

    // Generate test skeletons
    let testsGenerated = 0;
    const testDir = resolve(projectRoot, opts.testDir);

    if (opts.tests !== false) {
      console.log("\nGenerating test skeletons...");
      await mkdir(testDir, { recursive: true });

      const testConfig: TsTestGenConfig = {
        test_framework: "vitest",
        output_dir: testDir,
        include_source_body: opts.llmEnhance ?? false,
        llm_enhance: opts.llmEnhance ?? false,
      };

      for (const { module: mod } of fileResults) {
        if (mod.functions.length === 0 && mod.classes.length === 0) continue;
        const tests = generateTestSkeleton(mod, testConfig);
        for (const test of tests) {
          const testPath = resolve(testDir, relative(testDir, test.test_file_path));
          await mkdir(resolve(testPath, ".."), { recursive: true });
          await writeFile(testPath, test.test_content);
          testsGenerated++;
        }
      }

      if (opts.llmEnhance) {
        console.log("\nEnhancing tests with LLM...");
        await enhanceTestsWithLlm(testDir, fileResults);
      }
    }

    const resultObj = {
      files_scanned: files.length,
      functions_found: totalFunctions,
      classes_found: totalClasses,
      tests_generated: testsGenerated,
      index_path: resolve(projectRoot, ".devcompanion/index.json"),
      test_dir: opts.tests !== false ? testDir : null,
    };

    if (opts.json) {
      console.log(JSON.stringify(resultObj, null, 2));
    } else {
      console.log("");
      console.log("Onboarding complete:");
      console.log(`  Files scanned:    ${resultObj.files_scanned}`);
      console.log(`  Functions found:  ${resultObj.functions_found}`);
      console.log(`  Classes found:    ${resultObj.classes_found}`);
      console.log(`  Tests generated:  ${resultObj.tests_generated}`);
      console.log(`  Index written to: ${resultObj.index_path}`);
      if (resultObj.test_dir) {
        console.log(`  Tests written to: ${resultObj.test_dir}`);
      }
      console.log("");
      console.log("Top-level breakdown:");

      const byFile = new Map<string, number>();
      for (const entry of Object.values(functionIndex)) {
        byFile.set(entry.file_path, (byFile.get(entry.file_path) ?? 0) + 1);
      }
      const sorted = [...byFile.entries()].sort((a, b) => b[1] - a[1]);
      for (const [file, count] of sorted.slice(0, 20)) {
        console.log(`    ${file}: ${count} functions`);
      }
      if (sorted.length > 20) {
        console.log(`    ... and ${sorted.length - 20} more files`);
      }
    }
  });

async function enhanceTestsWithLlm(
  testDir: string,
  fileResults: Array<{ file: string; module: ParsedModule }>
): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { readFile: rf } = await import("node:fs/promises");
  const exec = promisify(execFile);

  for (const { file, module: mod } of fileResults) {
    for (const fn of mod.functions) {
      const testPath = resolve(testDir, `test_${file.split("/").pop()?.replace(/\.ts$/, "")}_${fn.name}.test.ts`);
      try {
        const skeleton = await rf(testPath, "utf-8");
        const prompt = `Read this test skeleton and improve it with meaningful assertions based on the function name "${fn.name}" with params (${fn.params.map(p => `${p.name}: ${p.type ?? "any"}`).join(", ")}). Return ONLY the improved test file:\n\n${skeleton}`;

        const { stdout } = await exec("claude", ["-p", prompt], {
          timeout: 30000,
          maxBuffer: 1024 * 1024,
        });

        if (stdout.includes("describe(") && stdout.includes("expect(")) {
          const codeMatch = stdout.match(/```typescript\n([\s\S]*?)```/) ?? stdout.match(/```ts\n([\s\S]*?)```/);
          const enhanced = codeMatch ? codeMatch[1] : stdout;
          await writeFile(testPath, enhanced);
          console.log(`  Enhanced: ${fn.name}`);
        }
      } catch {
        // LLM enhancement is best-effort
      }
    }
  }
}
