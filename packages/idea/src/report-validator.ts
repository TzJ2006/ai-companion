import type { ValidationResult } from "./types.js";
import { REQUIRED_SECTIONS } from "./types.js";

const MIN_SECTION_LENGTH = 50;

export function validateResearchReport(markdown: string): ValidationResult {
  const missing_sections: string[] = [];
  const empty_sections: string[] = [];

  for (const section of REQUIRED_SECTIONS) {
    const pattern = new RegExp(`^#{1,3}\\s+${escapeRegex(section)}`, "im");
    if (!pattern.test(markdown)) {
      const fuzzyPattern = new RegExp(
        `^#{1,3}\\s+${escapeRegex(section).replace(/s$/i, "s?")}`,
        "im"
      );
      if (!fuzzyPattern.test(markdown)) {
        missing_sections.push(section);
        continue;
      }
    }

    const sectionContent = extractSectionContent(markdown, section);
    if (sectionContent.length < MIN_SECTION_LENGTH) {
      empty_sections.push(section);
    }
  }

  return {
    valid: missing_sections.length === 0 && empty_sections.length === 0,
    missing_sections,
    empty_sections,
  };
}

function extractSectionContent(markdown: string, sectionName: string): string {
  const pattern = new RegExp(
    `^#{1,3}\\s+${escapeRegex(sectionName)}s?\\s*\\n([\\s\\S]*?)(?=^#{1,3}\\s|$)`,
    "im"
  );
  const match = pattern.exec(markdown);
  return match?.[1]?.trim() ?? "";
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatReportHeader(
  title: string,
  slug: string,
  date: string
): string {
  return [
    `# Research Report: ${title}`,
    "",
    `- **Idea**: ${slug}`,
    `- **Date**: ${date}`,
    `- **Status**: auto-generated`,
    "",
    "---",
    "",
  ].join("\n");
}
