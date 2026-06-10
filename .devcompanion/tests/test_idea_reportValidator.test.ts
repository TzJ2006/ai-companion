import { describe, it, expect } from "vitest";
import { validateResearchReport, REQUIRED_SECTIONS } from "@aidev/idea";

describe("validateResearchReport", () => {
  function buildValidReport(): string {
    return REQUIRED_SECTIONS.map(
      (section) => `## ${section}\n\n${"x".repeat(60)}\n`
    ).join("\n");
  }

  it("passes for a valid report with all sections", () => {
    const report = buildValidReport();
    const result = validateResearchReport(report);

    expect(result.valid).toBe(true);
    expect(result.missing_sections).toHaveLength(0);
    expect(result.empty_sections).toHaveLength(0);
  });

  it("detects missing sections", () => {
    const report = "## Summary\n\n" + "x".repeat(60);
    const result = validateResearchReport(report);

    expect(result.valid).toBe(false);
    expect(result.missing_sections.length).toBeGreaterThan(0);
    expect(result.missing_sections).toContain("Prior Art");
  });

  it("detects empty sections (under 50 chars)", () => {
    const report = REQUIRED_SECTIONS.map((section) => {
      if (section === "Risks") {
        return `## ${section}\n\nshort`;
      }
      return `## ${section}\n\n${"x".repeat(60)}\n`;
    }).join("\n");

    const result = validateResearchReport(report);

    expect(result.valid).toBe(false);
    expect(result.empty_sections).toContain("Risks");
  });

  it("accepts h3 headers", () => {
    const report = REQUIRED_SECTIONS.map(
      (section) => `### ${section}\n\n${"x".repeat(60)}\n`
    ).join("\n");

    const result = validateResearchReport(report);
    expect(result.valid).toBe(true);
  });

  it("handles empty string", () => {
    const result = validateResearchReport("");

    expect(result.valid).toBe(false);
    expect(result.missing_sections.length).toBe(REQUIRED_SECTIONS.length);
  });
});
