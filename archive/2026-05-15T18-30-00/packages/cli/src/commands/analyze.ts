import { Command } from "commander";
import { resolve, relative, extname } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { parseFileAuto, getSupportedExtensions, computeFunctionIdentity } from "@aidev/ast";
import type { FunctionSignature, ParsedModule } from "@aidev/ast";
import { analyzeBatch, analyzeModularityBatch, aggregateModuleMetrics, emitContractFiles } from "@aidev/core";
import type { AnalysisInput, AnalyzerOptions, ModularityInput, ModularityAnalyzerOptions } from "@aidev/core";
import { AnalysisStore, ModularityStore } from "@aidev/history";

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
        if (!IGNORED_DIRS.has(entry.name)) await walk(fullPath);
      } else if (entry.isFile()) {
        if (extensions.has(extname(entry.name).toLowerCase())) files.push(fullPath);
      }
    }
  }
  await walk(dir);
  return files;
}

function extractSourceBody(fileContent: string, startLine: number, endLine: number): string {
  const lines = fileContent.split("\n");
  return lines.slice(startLine - 1, endLine).join("\n");
}

function buildSignatureString(fn: FunctionSignature): string {
  const params = fn.params.map(p => `${p.name}: ${p.type ?? "any"}`).join(", ");
  const ret = fn.return_type ? `: ${fn.return_type}` : "";
  const prefix = fn.is_async ? "async " : "";
  return `${prefix}function ${fn.name}(${params})${ret}`;
}

export const analyzeCommand = new Command("analyze")
  .description("Analyze functions with LLM to understand why/what/how")
  .option("-p, --project <path>", "Project root path", ".")
  .option("--no-llm", "Use heuristic only (skip LLM calls)")
  .option("--concurrency <n>", "Max parallel LLM calls", "4")
  .option("--max-calls <n>", "Limit total LLM calls", "50")
  .option("--model <model>", "LLM model to use", "haiku")
  .option("--force", "Re-analyze even if analysis.json exists")
  .option("--json", "Output results as JSON")
  .option("--modularity", "Run modularity analysis (coupling, cohesion, contracts)")
  .option("--emit-contracts <dir>", "Write .ts contract files to directory")
  .action(async (opts) => {
    const projectRoot = resolve(opts.project);
    const store = new AnalysisStore(projectRoot);

    // Check if already analyzed
    if (!opts.force) {
      const existing = await store.read();
      if (existing && existing.total_analyzed > 0) {
        console.log(`Analysis already exists (${existing.total_analyzed} functions). Use --force to re-analyze.`);
        return;
      }
    }

    const supportedExts = new Set(getSupportedExtensions());
    console.log(`Scanning ${projectRoot}...`);
    const files = await collectFiles(projectRoot, supportedExts);
    console.log(`Found ${files.length} source files`);

    // Parse and build analysis inputs
    const inputs: AnalysisInput[] = [];
    const fileContents = new Map<string, string>();

    for (const file of files) {
      try {
        const content = await readFile(file, "utf-8");
        const relPath = relative(projectRoot, file).replace(/\\/g, "/");
        fileContents.set(relPath, content);
        const parsed = await parseFileAuto(file);
        parsed.file_path = relPath;

        const importLines = content.split("\n")
          .filter(l => l.startsWith("import ") || l.startsWith("from "))
          .slice(0, 20);

        const allFunctions: Array<{ fn: FunctionSignature; className: string | null }> = [];
        for (const fn of parsed.functions) {
          allFunctions.push({ fn, className: null });
        }
        for (const cls of parsed.classes) {
          for (const method of cls.methods) {
            allFunctions.push({ fn: method, className: cls.name });
          }
        }

        for (const { fn, className } of allFunctions) {
          const identity = computeFunctionIdentity(relPath, fn);
          const sourceBody = (fn.start_line && fn.end_line)
            ? extractSourceBody(content, fn.start_line, fn.end_line)
            : "";

          inputs.push({
            function_hash: identity.hash,
            file_path: relPath,
            function_name: fn.name,
            class_name: className,
            signature: buildSignatureString(fn),
            source_body: sourceBody,
            imports: importLines,
            class_context: className ? `class ${className}` : null,
          });
        }
      } catch (e) {
        console.warn(`  Warning: ${relative(projectRoot, file)}: ${(e as Error).message}`);
      }
    }

    console.log(`Analyzing ${inputs.length} functions...`);

    const analyzerOpts: Partial<AnalyzerOptions> = {
      concurrency: parseInt(opts.concurrency, 10),
      maxLlmCalls: opts.llm === false ? 0 : parseInt(opts.maxCalls, 10),
      model: opts.model,
      fallbackToHeuristic: true,
    };

    const results = await analyzeBatch(inputs, analyzerOpts, (done, total, current) => {
      process.stdout.write(`\r  [${done}/${total}] ${current}`);
    });
    console.log("");

    await store.upsertBatch(results);

    const llmCount = results.filter(r => r.analysis_source === "llm").length;
    const heuristicCount = results.filter(r => r.analysis_source === "heuristic").length;

    if (opts.json) {
      const data = await store.read();
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(`\nAnalysis complete:`);
      console.log(`  Functions analyzed: ${results.length}`);
      console.log(`  LLM analyzed:      ${llmCount}`);
      console.log(`  Heuristic:         ${heuristicCount}`);
      console.log(`  Stored in:         .devcompanion/analysis.json`);
    }

    // Modularity analysis
    if (opts.modularity) {
      console.log("\nRunning modularity analysis...");
      const modStore = new ModularityStore(projectRoot);

      const modInputs: ModularityInput[] = inputs.map(inp => ({
        function_hash: inp.function_hash,
        file_path: inp.file_path,
        function_name: inp.function_name,
        class_name: inp.class_name,
        signature: inp.signature,
        source_body: inp.source_body,
        imports: inp.imports,
        params: [],
        return_type: null,
        is_async: inp.signature.startsWith("async"),
      }));

      const modOpts: Partial<ModularityAnalyzerOptions> = {
        concurrency: parseInt(opts.concurrency, 10),
        maxLlmCalls: opts.llm === false ? 0 : parseInt(opts.maxCalls, 10),
        model: opts.model,
        fallbackToHeuristic: true,
      };

      const modResults = await analyzeModularityBatch(modInputs, modOpts, (done, total, current) => {
        process.stdout.write(`\r  [${done}/${total}] ${current}`);
      });
      console.log("");

      const modules = aggregateModuleMetrics(modResults);
      await modStore.upsertBatch(modResults, modules);

      const godCount = modResults.filter(r => r.is_god_function).length;
      const avgCohesion = modResults.reduce((s, r) => s + r.cohesion.score, 0) / modResults.length;
      const avgCoupling = modResults.reduce((s, r) => s + r.coupling.score, 0) / modResults.length;
      const selfContained = modResults.filter(r => r.coupling.self_contained).length;
      const totalRecs = modResults.reduce((s, r) => s + r.recommendations.length, 0);

      console.log(`\nModularity Analysis:`);
      console.log(`  Functions analyzed: ${modResults.length}`);
      console.log(`  Avg cohesion:      ${avgCohesion.toFixed(2)}`);
      console.log(`  Avg coupling:      ${avgCoupling.toFixed(2)}`);
      console.log(`  God functions:     ${godCount}`);
      console.log(`  Self-contained:    ${selfContained}/${modResults.length} (${Math.round(selfContained/modResults.length*100)}%)`);
      console.log(`  Recommendations:   ${totalRecs} total`);
      console.log(`  Stored in:         .devcompanion/modularity.json`);

      if (opts.emitContracts) {
        const written = await emitContractFiles(modResults, resolve(opts.emitContracts));
        console.log(`  Contracts written: ${written.length} files to ${opts.emitContracts}`);
      }
    }
  });
