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
  .option("--style <style>", "Diff style: side-by-side or line-by-line", "side-by-side")
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
    const rawDiffs = session.changes
      .filter((c) => c.old_content || c.new_content)
      .map((c) => buildMinimalDiff(c.file_path, c.old_content, c.new_content, c.start_line));

    const html = renderSessionToHtml(session, rawDiffs, {
      show_test_status: true,
      show_error_ids: true,
      style: opts.style as "side-by-side" | "line-by-line",
    });

    const outputPath = resolve(opts.output);
    await writeFile(outputPath, html);
    console.log(`HTML report written to: ${outputPath}`);
  });

function buildMinimalDiff(
  filePath: string,
  oldContent: string | null,
  newContent: string | null,
  startLine: number
): string {
  const oldLines = (oldContent ?? "").split("\n");
  const newLines = (newContent ?? "").split("\n");

  let diff = `diff --git a/${filePath} b/${filePath}\n`;
  diff += `--- a/${filePath}\n`;
  diff += `+++ b/${filePath}\n`;
  diff += `@@ -${startLine},${oldLines.length} +${startLine},${newLines.length} @@\n`;

  for (const line of oldLines) {
    if (line) diff += `-${line}\n`;
  }
  for (const line of newLines) {
    if (line) diff += `+${line}\n`;
  }

  return diff;
}
