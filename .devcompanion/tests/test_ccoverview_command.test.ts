import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Tests live in .devcompanion/tests/, so the repo root is two levels up.
const repoRoot = resolve(import.meta.dirname, "..", "..");
const commandPath = resolve(repoRoot, ".claude", "commands", "ccoverview.md");

function readCommand(): string {
  return readFileSync(commandPath, "utf8");
}

/** Extract the YAML frontmatter block delimited by leading `---` lines. */
function extractFrontmatter(content: string): string | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match ? match[1] : null;
}

describe("ccoverview command registration", () => {
  it("file exists at .claude/commands/ccoverview.md", () => {
    expect(existsSync(commandPath)).toBe(true);
  });

  it("has YAML frontmatter delimited by --- lines", () => {
    const frontmatter = extractFrontmatter(readCommand());
    expect(frontmatter).not.toBeNull();
  });

  it("frontmatter contains a non-empty description", () => {
    const frontmatter = extractFrontmatter(readCommand());
    expect(frontmatter).not.toBeNull();
    const descMatch = (frontmatter as string).match(/^description:\s*(.+)$/m);
    expect(descMatch).not.toBeNull();
    const description = (descMatch as RegExpMatchArray)[1]
      .trim()
      .replace(/^["']|["']$/g, "")
      .trim();
    expect(description.length).toBeGreaterThan(0);
  });

  it("body references the skill specification at skills/ccoverview/SKILL.md", () => {
    const content = readCommand();
    expect(content).toContain("skills/ccoverview/SKILL.md");
  });

  it("allows --target instead of forbidding it", () => {
    const content = readCommand();
    expect(content).toContain("--target");
    expect(content).not.toMatch(/no `--target`/);
    expect(content).not.toMatch(/always omit `--target`/i);
  });
});
