import { Command } from "commander";
import { resolve } from "node:path";
import { HistoryStore } from "@aidev/history";

export const initCommand = new Command("init")
  .description("Initialize AI Dev Companion in the current project")
  .option("-p, --project <path>", "Project root path", ".")
  .action(async (opts) => {
    const projectRoot = resolve(opts.project);
    const store = new HistoryStore(projectRoot);
    await store.init();
    console.log(`AI Dev Companion initialized in: ${projectRoot}`);
    console.log("  Created: .devcompanion/");
    console.log("  Updated: .gitignore");
    console.log("");
    console.log("Usage:");
    console.log("  aidev review --reason 'Added auth module'   # Record changes");
    console.log("  aidev render --latest                       # Generate HTML report");
    console.log("  aidev history src/auth.py                   # View file history");
  });
