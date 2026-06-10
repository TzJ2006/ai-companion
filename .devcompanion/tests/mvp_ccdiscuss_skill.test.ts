import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Tests live in .devcompanion/tests/, so the repo root is two levels up.
const repoRoot = resolve(import.meta.dirname, "..", "..");
const skillPath = resolve(repoRoot, "skills", "ccdiscuss", "SKILL.md");

function readSkill(): string {
  return readFileSync(skillPath, "utf8");
}

describe("ccdiscuss SKILL.md", () => {
  it("file exists at skills/ccdiscuss/SKILL.md", () => {
    expect(existsSync(skillPath)).toBe(true);
  });

  it("has YAML frontmatter with name: ccdiscuss and origin: custom", () => {
    const content = readSkill();
    // Frontmatter must be the very first thing in the file.
    expect(content.startsWith("---")).toBe(true);

    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    expect(fmMatch).not.toBeNull();
    const frontmatter = fmMatch![1];

    expect(frontmatter).toMatch(/^name:\s*ccdiscuss\s*$/m);
    expect(frontmatter).toMatch(/^origin:\s*custom\s*$/m);
    // description key present (folded scalar or inline)
    expect(frontmatter).toMatch(/^description:/m);
  });

  it("documents all 6 steps of the alignment loop", () => {
    const content = readSkill();
    const lower = content.toLowerCase();

    // 1. conflict / duplication check reusing ccplan Phase 1 ECL Reuse Discovery
    expect(lower).toMatch(/conflict/);
    expect(lower).toMatch(/duplicat/);
    expect(lower).toMatch(/ecl reuse discovery/);

    // 2. human writes the expected result FIRST, before AI reveals inference
    expect(lower).toMatch(/human/);
    expect(lower).toMatch(/expected result/);
    expect(lower).toMatch(/first/);
    // ordering: human-first appears before the AI reveals its inference
    expect(lower).toMatch(/human[\s\S]*expected result[\s\S]*first|first[\s\S]*human/);

    // 3. the 5 questions + divergence flagging. Accept Chinese canonical set.
    const fiveQuestions = ["是什么", "为什么做", "如何做", "为什么这样做", "期望结果"];
    for (const q of fiveQuestions) {
      expect(content).toContain(q);
    }
    expect(lower).toMatch(/diverg/);

    // 4. resolve the divergence on the spot
    expect(lower).toMatch(/resolve/);
    expect(lower).toMatch(/on the spot|on-the-spot|immediately/);

    // 5. verification as value(s) + comparison code, else soft + human sign-off
    expect(lower).toMatch(/verif/);
    expect(lower).toMatch(/comparison/);
    expect(lower).toMatch(/number/);
    expect(lower).toMatch(/boolean/);
    expect(lower).toMatch(/soft/);
    expect(lower).toMatch(/sign[\s-]?off/);

    // 6. split into one or more ECL nodes, each carrying the 5 questions
    expect(lower).toMatch(/ecl node/);
    expect(lower).toMatch(/one or more|multiple/);

    // There should be at least 6 distinct numbered/heading step markers.
    const stepHeadings = content.match(/^#{2,4}\s*Step\s*\d+/gim) ?? [];
    const numberedMarkers = content.match(/^\s*\d+\.\s/gm) ?? [];
    const hasSixHeadings = stepHeadings.length >= 6;
    const hasSixNumbered = numberedMarkers.length >= 6;
    expect(hasSixHeadings || hasSixNumbered).toBe(true);
  });

  it("frames the loop EXPLICITLY as best-effort (not always-on/enforced/gate)", () => {
    const content = readSkill();
    const lower = content.toLowerCase();

    // Must contain a best-effort framing.
    expect(lower).toMatch(/best[\s-]?effort/);
  });

  it("documents the read-if-present handoff to /ccplan with no hard prerequisite", () => {
    const content = readSkill();
    const lower = content.toLowerCase();

    expect(lower).toMatch(/ccplan/);
    // read-if-present phrasing
    expect(lower).toMatch(/read[\s-]?if[\s-]?present|reads?\s+(it\s+)?if\s+present|if\s+present/);
    // explicitly NOT a hard prerequisite
    expect(lower).toMatch(/no\s+hard\s+prerequisite|not\s+a\s+(hard\s+)?prerequisite|no\s+prerequisite/);
  });

  it("does NOT claim hard enforcement / always-on / gate semantics", () => {
    const content = readSkill();

    // Collect non-empty, non-code lines for sentence-level scanning.
    const lines = content.split("\n");
    const offendingLines: string[] = [];

    // Patterns that would assert the loop IS an enforced/always-on/gate mechanism.
    // We only flag POSITIVE claims; negations ("NOT a gate", "no enforcement",
    // "does not require", "deferred") are explicitly allowed.
    const negationGuard =
      /\b(not|no|never|without|n't|isn't|aren't|won't|cannot|can't|deferred|skip|skipped|loosely)\b/i;

    const badClaims: RegExp[] = [
      /\balways[\s-]?on\b/i,
      /\benforced?\b/i,
      /\benforcement\b/i,
      /\bmandatory\b/i,
      /\brequired\s+before\b/i,
      /\bhard\s+(gate|prerequisite|mechanism|requirement)\b/i,
      /\b(is|acts?\s+as)\s+a\s+gate\b/i,
      /\bgates?\s+(planning|ccplan|the\s+plan)\b/i,
      // "blocks" only as an enforcement verb (blocks edits/writes/planning/etc.),
      // not the innocent noun ("verification block", "YAML block").
      /\bblocks?\s+(all\s+)?(edit|write|plan|ccplan|operation|the)/i,
    ];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      // Skip fenced-code and obvious YAML/code lines (verification:, kind:, etc.).
      if (line.startsWith("```")) continue;

      for (const bad of badClaims) {
        if (bad.test(line)) {
          // Allow the line if it is framed as a negation / disclaimer.
          if (negationGuard.test(line)) continue;
          offendingLines.push(line);
          break;
        }
      }
    }

    expect(
      offendingLines,
      `Found lines claiming hard enforcement/always-on/gate semantics:\n${offendingLines.join(
        "\n"
      )}`
    ).toHaveLength(0);
  });
});
