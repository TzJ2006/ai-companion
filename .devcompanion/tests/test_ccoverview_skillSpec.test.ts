import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Tests live in .devcompanion/tests/, so the repo root is two levels up.
const repoRoot = resolve(import.meta.dirname, "..", "..");
const skillPath = resolve(repoRoot, "skills", "ccoverview", "SKILL.md");

function readSkill(): string {
  return readFileSync(skillPath, "utf8");
}

describe("ccoverview SKILL.md", () => {
  it("file exists at skills/ccoverview/SKILL.md", () => {
    expect(existsSync(skillPath)).toBe(true);
  });

  it("references the existing generator script scripts/generate-overview.ts", () => {
    const content = readSkill();
    expect(content).toContain("scripts/generate-overview.ts");
  });

  it("documents the --skip-translation fast single-language mode", () => {
    const content = readSkill();
    const lower = content.toLowerCase();
    expect(content).toContain("--skip-translation");
    // It is described as the fast single-language mode.
    expect(lower).toMatch(/fast/);
    expect(lower).toMatch(/single[\s-]?language/);
  });

  it("mentions the bilingual output: both overview-en.html and overview-zh.html", () => {
    const content = readSkill();
    expect(content).toContain("overview-en.html");
    expect(content).toContain("overview-zh.html");
  });
});
