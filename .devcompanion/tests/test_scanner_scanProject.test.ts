import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MAX_DEPTH, scanProject } from "../../packages/dashboard/src/scanner.ts";

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), "dash-scan-"));
}

function writeHtml(root: string, relativePath: string): void {
  const full = join(root, relativePath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, "<html></html>");
}

function names(root: string): string[] {
  return scanProject("demo", root).reports.map((r) => r.relativePath).sort();
}

describe("scanProject", () => {
  it("finds root-level html leftover reports", () => {
    const root = makeProject();
    try {
      writeHtml(root, "review.html");
      expect(names(root)).toEqual(["review.html"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("finds html under .devcompanion/reports", () => {
    const root = makeProject();
    try {
      writeHtml(root, ".devcompanion/reports/overview.html");
      writeHtml(root, ".devcompanion/reports/onboard-report.html");
      expect(names(root)).toEqual([
        ".devcompanion/reports/onboard-report.html",
        ".devcompanion/reports/overview.html",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips archive/ even inside .devcompanion/reports", () => {
    const root = makeProject();
    try {
      writeHtml(root, ".devcompanion/reports/overview.html");
      writeHtml(root, ".devcompanion/reports/archive/overview-old.html");
      writeHtml(root, "archive/stale.html");
      expect(names(root)).toEqual([".devcompanion/reports/overview.html"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips other dot directories and node_modules", () => {
    const root = makeProject();
    try {
      writeHtml(root, ".hidden/secret.html");
      writeHtml(root, "node_modules/pkg/index.html");
      writeHtml(root, ".devcompanion/reports/overview.html");
      expect(names(root)).toEqual([".devcompanion/reports/overview.html"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it(`does not walk deeper than MAX_DEPTH (${MAX_DEPTH})`, () => {
    const root = makeProject();
    try {
      writeHtml(root, "a/b/ok.html");
      writeHtml(root, "a/b/c/too-deep.html");
      expect(names(root)).toEqual(["a/b/ok.html"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
