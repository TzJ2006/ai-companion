import { Command } from "commander";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { IdeaStore, executeResearch } from "@aidev/idea";
import type { IdeaStatus } from "@aidev/idea";

export const ideaCommand = new Command("idea")
  .description("Manage idea backlog and research");

ideaCommand
  .command("add")
  .description("Record a new idea")
  .argument("<title>", "Idea title")
  .option("-d, --description <text>", "Detailed description", "")
  .option("-t, --tags <tags>", "Comma-separated tags", "")
  .option("-p, --project <path>", "Project root path", ".")
  .action(async (title: string, opts) => {
    const projectRoot = resolve(opts.project);
    const store = new IdeaStore(projectRoot);
    const tags = opts.tags ? opts.tags.split(",").map((t: string) => t.trim()) : [];

    const idea = await store.createIdea(title, opts.description, tags);
    console.log(`Created idea: ${idea.slug}`);
    console.log(`  Title: ${idea.title}`);
    console.log(`  Status: ${idea.status}`);
    if (tags.length > 0) console.log(`  Tags: ${tags.join(", ")}`);
  });

ideaCommand
  .command("list")
  .description("List all ideas")
  .option("-s, --status <status>", "Filter by status")
  .option("--tag <tag>", "Filter by tag")
  .option("-p, --project <path>", "Project root path", ".")
  .action(async (opts) => {
    const projectRoot = resolve(opts.project);
    const store = new IdeaStore(projectRoot);

    const filter: { status?: IdeaStatus; tag?: string } = {};
    if (opts.status) filter.status = opts.status as IdeaStatus;
    if (opts.tag) filter.tag = opts.tag;

    const ideas = await store.listIdeas(filter);

    if (ideas.length === 0) {
      console.log("No ideas found.");
      return;
    }

    console.log(`Found ${ideas.length} idea(s):\n`);
    for (const idea of ideas) {
      const tags = idea.tags.length > 0 ? ` [${idea.tags.join(", ")}]` : "";
      const research = idea.research_size_bytes
        ? ` (${Math.round(idea.research_size_bytes / 1024)}KB report)`
        : "";
      console.log(`  ${statusIcon(idea.status)} ${idea.slug} — ${idea.title}${tags}${research}`);
    }
  });

ideaCommand
  .command("show")
  .description("Show idea details or research report")
  .argument("<slug>", "Idea slug")
  .option("--report", "Show research report instead of idea details")
  .option("-p, --project <path>", "Project root path", ".")
  .action(async (slug: string, opts) => {
    const projectRoot = resolve(opts.project);
    const store = new IdeaStore(projectRoot);

    if (opts.report) {
      const reportPath = store.getResearchReportPath(slug);
      if (!existsSync(reportPath)) {
        console.error(`No research report found for "${slug}". Run \`idea research ${slug}\` first.`);
        process.exitCode = 1;
        return;
      }
      const content = await readFile(reportPath, "utf-8");
      const lines = content.split("\n");
      if (lines.length > 100) {
        console.log(lines.slice(0, 100).join("\n"));
        console.log(`\n... (${lines.length - 100} more lines. Full report: ${reportPath})`);
      } else {
        console.log(content);
      }
      return;
    }

    const idea = await store.getIdea(slug);
    if (!idea) {
      console.error(`Idea not found: ${slug}`);
      process.exitCode = 1;
      return;
    }

    console.log(`Slug:        ${idea.slug}`);
    console.log(`Title:       ${idea.title}`);
    console.log(`Status:      ${idea.status}`);
    console.log(`Tags:        ${idea.tags.join(", ") || "(none)"}`);
    console.log(`Created:     ${idea.created}`);
    console.log(`Updated:     ${idea.updated}`);
    if (idea.description) {
      console.log(`\nDescription:\n  ${idea.description}`);
    }
    if (idea.failure_reason) {
      console.log(`\nFailure reason:\n  ${idea.failure_reason}`);
    }
  });

ideaCommand
  .command("research")
  .description("Run research on an idea")
  .argument("<slug>", "Idea slug to research")
  .option("-m, --model <model>", "Claude model to use", "sonnet")
  .option("--timeout <ms>", "Timeout in milliseconds", "120000")
  .option("-p, --project <path>", "Project root path", ".")
  .action(async (slug: string, opts) => {
    const projectRoot = resolve(opts.project);
    const store = new IdeaStore(projectRoot);

    const idea = await store.getIdea(slug);
    if (!idea) {
      console.error(`Idea not found: ${slug}`);
      process.exitCode = 1;
      return;
    }

    console.log(`Researching: ${idea.title}`);
    console.log(`  Model: ${opts.model}`);
    console.log(`  Timeout: ${opts.timeout}ms`);
    console.log("");

    try {
      const { reportPath, validation } = await executeResearch(store, slug, {
        model: opts.model,
        timeout: parseInt(opts.timeout, 10),
        projectRoot,
      });

      if (validation.valid) {
        console.log(`Research complete! Report saved to:`);
        console.log(`  ${reportPath}`);
      } else {
        console.warn(`Research completed but report validation failed:`);
        if (validation.missing_sections.length > 0) {
          console.warn(`  Missing sections: ${validation.missing_sections.join(", ")}`);
        }
        if (validation.empty_sections.length > 0) {
          console.warn(`  Empty sections: ${validation.empty_sections.join(", ")}`);
        }
        console.warn(`  Report saved (incomplete) at: ${reportPath}`);
        process.exitCode = 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Research failed: ${message}`);
      process.exitCode = 1;
    }
  });

function statusIcon(status: IdeaStatus): string {
  switch (status) {
    case "draft": return "○";
    case "researching": return "◐";
    case "researched": return "●";
    case "failed": return "✗";
    case "archived": return "◌";
  }
}
