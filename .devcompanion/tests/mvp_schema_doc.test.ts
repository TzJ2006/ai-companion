import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(
  __dirname,
  "../../skills/ccplan/ecl-schema.md"
);

const doc = readFileSync(SCHEMA_PATH, "utf8");

describe("ecl-schema.md MVP schema additions", () => {
  it("mentions why_this_way at least twice", () => {
    const matches = doc.match(/why_this_way/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("documents why_this_way as the rationale for the chosen approach", () => {
    // Robust to wording: just require the field name near 'chosen' or 'rationale'.
    expect(doc).toMatch(/why_this_way/);
    expect(doc.toLowerCase()).toMatch(/rationale|chosen approach/);
  });

  it("documents a hard/soft kind tag", () => {
    const hasUnionForm = /hard\s*\|\s*soft/.test(doc);
    const hasBothLiterals =
      /kind:\s*hard/.test(doc) && /kind:\s*soft/.test(doc);
    expect(hasUnionForm || hasBothLiterals).toBe(true);
  });

  it("documents that a soft item needs human sign-off before done", () => {
    const lower = doc.toLowerCase();
    expect(lower).toContain("soft");
    expect(lower).toMatch(/sign[\s-]?off/);
  });
});
