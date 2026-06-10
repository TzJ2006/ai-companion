import { readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { callClaude } from "@aidev/llm";
import type { ClaudeCallOptions } from "@aidev/llm";
import { IdeaStore } from "./idea-store.js";
import { validateResearchReport, formatReportHeader } from "./report-validator.js";
import type { IdeaEntry, ResearchOptions, ValidationResult } from "./types.js";
import { REQUIRED_SECTIONS } from "./types.js";

export function buildResearchPrompt(idea: IdeaEntry, projectContext: string): string {
  const sections = REQUIRED_SECTIONS.map((s) => `## ${s}`).join("\n\n");

  return `You are a technical research assistant. Research the following idea and produce a comprehensive report.

<idea>
<title>${sanitize(idea.title)}</title>
<description>${sanitize(idea.description)}</description>
<tags>${idea.tags.join(", ")}</tags>
</idea>

<project_context>
${projectContext}
</project_context>

Produce a research report with EXACTLY these sections (use these exact headings):

${sections}

For "Prior Art": search for existing implementations, open-source projects, npm/PyPI packages, papers, or blog posts that solve a similar problem. List each with a link (if known) and a brief description.

For "Comparison": compare the existing solutions to this idea. What does this idea do differently? What are the gaps in existing solutions that this idea addresses?

For "Technical Feasibility": assess whether this idea is technically feasible given the project context. Note any hard blockers or unknowns.

For "Implementation Approaches": propose 3-5 distinct ways to implement this idea, from simplest to most comprehensive. For each approach, note complexity, trade-offs, and estimated effort.

For "Risks": identify technical risks, adoption risks, and maintenance risks.

For "Recommended Next Steps": provide a prioritized list of concrete actions to move this idea forward.

Be thorough and specific. Reference real projects and technologies where possible.`;
}

function sanitize(input: string): string {
  return input.replace(/[\x00-\x1f]/g, "").slice(0, 2000);
}

async function gatherProjectContext(projectRoot: string): Promise<string> {
  const parts: string[] = [];

  const packageJsonPath = resolve(projectRoot, "package.json");
  if (existsSync(packageJsonPath)) {
    try {
      const raw = await readFile(packageJsonPath, "utf-8");
      const pkg = JSON.parse(raw);
      parts.push(`Package: ${pkg.name ?? "unknown"}`);
      if (pkg.dependencies) {
        parts.push(`Dependencies: ${Object.keys(pkg.dependencies).join(", ")}`);
      }
    } catch { /* ignore */ }
  }

  const readmePath = resolve(projectRoot, "README.md");
  if (existsSync(readmePath)) {
    try {
      const readme = await readFile(readmePath, "utf-8");
      parts.push(`README excerpt:\n${readme.slice(0, 1500)}`);
    } catch { /* ignore */ }
  }

  const claudeMdPath = resolve(projectRoot, "CLAUDE.md");
  if (existsSync(claudeMdPath)) {
    try {
      const claudeMd = await readFile(claudeMdPath, "utf-8");
      parts.push(`CLAUDE.md excerpt:\n${claudeMd.slice(0, 1500)}`);
    } catch { /* ignore */ }
  }

  return parts.join("\n\n") || "No project context available.";
}

export async function executeResearch(
  store: IdeaStore,
  slug: string,
  options: ResearchOptions = {}
): Promise<{ reportPath: string; validation: ValidationResult }> {
  const idea = await store.getIdea(slug);
  if (!idea) throw new Error(`Idea not found: ${slug}`);

  if (idea.status === "researching") {
    throw new Error(`Idea "${slug}" is already being researched. Wait or reset its status.`);
  }

  if (!store.acquireLock(slug)) {
    throw new Error(`Cannot acquire lock for "${slug}". Another process may be researching it.`);
  }

  try {
    await store.updateIdeaStatus(slug, "researching");

    const projectRoot = options.projectRoot ?? process.cwd();
    const projectContext = await gatherProjectContext(projectRoot);
    const prompt = buildResearchPrompt(idea, projectContext);

    const callOptions: ClaudeCallOptions = {
      model: options.model ?? "sonnet",
      timeout: options.timeout ?? 120_000,
      cwd: projectRoot,
      maxOutputBytes: 32_768,
    };

    const result = await callClaude(prompt, callOptions);

    const validation = validateResearchReport(result.output);

    if (!validation.valid) {
      await store.updateIdeaStatus(slug, "failed", {
        failure_reason: `Report validation failed. Missing: [${validation.missing_sections.join(", ")}]. Empty: [${validation.empty_sections.join(", ")}]`,
      });
      const reportPath = store.getResearchReportPath(slug);
      const header = formatReportHeader(idea.title, slug, new Date().toISOString());
      await writeFile(reportPath, header + result.output, "utf-8");
      return { reportPath, validation };
    }

    const header = formatReportHeader(idea.title, slug, new Date().toISOString());
    const fullReport = header + result.output;
    const reportPath = store.getResearchReportPath(slug);
    await writeFile(reportPath, fullReport, "utf-8");

    const reportStat = await stat(reportPath);
    await store.setResearchSize(slug, reportStat.size);
    await store.updateIdeaStatus(slug, "researched");

    return { reportPath, validation };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await store.updateIdeaStatus(slug, "failed", { failure_reason: reason });
    throw error;
  } finally {
    store.releaseLock(slug);
  }
}
