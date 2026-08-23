import { Command } from "commander";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { HistoryStore } from "@aidev/history";
import { renderSessionToHtml } from "@aidev/render";

export const renderCommand = new Command("render")
  .description("Render a review session to HTML")
  .option("-s, --session <filename>", "Session file to render (from .devcompanion/reviews/)")
  .option("--latest", "Render the most recent session", false)
  .option("-o, --output <path>", "Output HTML file path", "./review.html")
  .option("-p, --project <path>", "Project root path", ".")
  .action(async (opts) => {
    const projectRoot = resolve(opts.project);
    const store = new HistoryStore(projectRoot);

    let sessionFile: string;
    if (opts.latest) {
      const sessions = await store.listSessions(1);
      if (sessions.length === 0) {
        console.error("No review sessions found.");
        return;
      }
      sessionFile = sessions[0];
    } else if (opts.session) {
      sessionFile = opts.session;
    } else {
      console.error("Specify --session <file> or --latest");
      return;
    }

    const session = await store.getSession(sessionFile);
    const html = renderSessionToHtml(session);

    const outputPath = resolve(opts.output);
    await writeFile(outputPath, html);
    console.log(`HTML report written to: ${outputPath}`);
  });
