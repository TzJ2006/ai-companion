import { describe, it, expect } from "vitest";
import { mkdirSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { resolveTargetProject, resolveGitRoot, resolveReportsDir } from "../../scripts/lib/resolve-target.ts";

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function samePath(a: string, b: string): boolean {
  return resolve(a).replace(/\\/g, "/").toLowerCase() === resolve(b).replace(/\\/g, "/").toLowerCase();
}

describe("resolveTargetProject", () => {
  it("uses --target when provided, relative to cwd", () => {
    const cwd = makeTempDir("target-explicit-");
    try {
      const result = resolveTargetProject(["node", "script.ts", "--target", "nested"], cwd);
      expect(samePath(result, join(cwd, "nested"))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("resolves an absolute --target without using git root", () => {
    const cwd = makeTempDir("target-abs-cwd-");
    const target = makeTempDir("target-abs-dest-");
    mkdirSync(join(cwd, ".git"));
    try {
      const result = resolveTargetProject(["node", "script.ts", "--target", target], cwd);
      expect(samePath(result, target)).toBe(true);
      expect(samePath(result, cwd)).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(target, { recursive: true, force: true });
    }
  });

  it("defaults to git root of cwd when --target is omitted", () => {
    const root = makeTempDir("target-git-");
    const nested = join(root, "packages", "app");
    mkdirSync(nested, { recursive: true });
    mkdirSync(join(root, ".git"));
    try {
      const result = resolveTargetProject(["node", "script.ts"], nested);
      expect(samePath(result, root)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("defaults to cwd when --target is omitted and there is no git root", () => {
    const cwd = makeTempDir("target-nogit-");
    try {
      expect(resolveGitRoot(cwd)).toBeNull();
      const result = resolveTargetProject(["node", "script.ts"], cwd);
      expect(samePath(result, cwd)).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("resolveReportsDir", () => {
  it("places reports under .devcompanion/reports", () => {
    const root = "/tmp/proj";
    expect(resolveReportsDir(root).replace(/\\/g, "/")).toMatch(/\.devcompanion\/reports$/);
  });
});

describe("generator wiring", () => {
  const repoRoot = resolve(import.meta.dirname, "..", "..");

  it("generate-overview.ts defaults via resolveTargetProject, not companion SCRIPT_ROOT", () => {
    const src = readFileSync(resolve(repoRoot, "scripts", "generate-overview.ts"), "utf8");
    expect(src).toContain("resolveTargetProject");
    expect(src).toContain("./lib/resolve-target.ts");
    expect(src).not.toMatch(/return SCRIPT_ROOT/);
  });

  it("generate-report.ts writes onboard-report.html under .devcompanion/reports", () => {
    const src = readFileSync(resolve(repoRoot, "scripts", "generate-report.ts"), "utf8");
    expect(src).toContain("resolveTargetProject");
    expect(src).toContain("onboard-report.html");
    expect(src).toContain("resolveReportsDir");
    expect(src).not.toMatch(/resolve\(PROJECT_ROOT,\s*"onboard-report\.html"\)/);
  });
});
