import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, basename, dirname, relative } from "node:path";
import type { FunctionAnalysis } from "@aidev/types";
import type { EnhancedFeature } from "./semantic-ecl-inferrer.ts";

export interface TestSkeleton {
  file_path: string;
  content: string;
  type: "unit" | "integration";
  target_name: string;
}

export interface TestGenerationResult {
  generated: string[];
  skipped: string[];
  total_assertions: number;
}

export function generateFunctionTestSkeleton(
  analysis: FunctionAnalysis,
  language: string
): TestSkeleton | null {
  if (isInternalFunction(analysis)) {
    return null;
  }

  if (language.includes("Python") || language.includes("python")) {
    return generatePytestSkeleton(analysis);
  }

  return generateVitestSkeleton(analysis);
}

export function generateFeatureTestSkeleton(
  feature: EnhancedFeature,
  language: string
): TestSkeleton {
  if (language.includes("Python") || language.includes("python")) {
    return generatePytestFeatureSkeleton(feature);
  }

  return generateVitestFeatureSkeleton(feature);
}

export function writeTestFiles(
  projectPath: string,
  skeletons: TestSkeleton[]
): TestGenerationResult {
  const testDirectory = join(projectPath, ".devcompanion", "tests");
  mkdirSync(testDirectory, { recursive: true });

  const generated: string[] = [];
  const skipped: string[] = [];
  let totalAssertions = 0;

  for (const skeleton of skeletons) {
    const outputPath = join(testDirectory, skeleton.file_path);
    const outputDir = dirname(outputPath);
    mkdirSync(outputDir, { recursive: true });

    if (existsSync(outputPath)) {
      skipped.push(skeleton.file_path);
      continue;
    }

    writeFileSync(outputPath, skeleton.content, "utf-8");
    generated.push(skeleton.file_path);
    totalAssertions += countAssertionPlaceholders(skeleton.content);
  }

  return { generated, skipped, total_assertions: totalAssertions };
}

function generateVitestSkeleton(analysis: FunctionAnalysis): TestSkeleton {
  const testFileName = buildTestFileName(analysis, "test.ts");
  const importPath = buildImportPath(analysis);
  const lines: string[] = [];

  lines.push(`import { describe, it, expect } from "vitest";`);
  lines.push(`// import { ${analysis.function_name} } from "${importPath}";`);
  lines.push("");
  lines.push(`describe("${analysis.function_name}", () => {`);

  lines.push(`  // What: ${analysis.what}`);
  lines.push(`  // Why: ${analysis.why}`);
  lines.push("");

  if (analysis.inputs.length > 0) {
    lines.push(`  it("should accept valid inputs and return expected output", () => {`);
    lines.push(`    // Inputs:`);
    for (const input of analysis.inputs) {
      lines.push(`    //   ${input.name} (${input.type ?? "unknown"}): ${input.role}`);
      if (input.constraints) {
        lines.push(`    //   Constraint: ${input.constraints}`);
      }
    }
    lines.push(`    // Expected output: ${analysis.outputs.meaning}`);
    lines.push(`    expect(true).toBe(false); // TODO: implement`);
    lines.push(`  });`);
    lines.push("");
  }

  if (analysis.outputs.nullable) {
    lines.push(`  it("should handle null/undefined return case", () => {`);
    lines.push(`    // Output can be nullable: ${analysis.outputs.meaning}`);
    lines.push(`    expect(true).toBe(false); // TODO: implement`);
    lines.push(`  });`);
    lines.push("");
  }

  if (analysis.throws.length > 0) {
    for (const throwDesc of analysis.throws) {
      lines.push(`  it("should throw when: ${escapeTestTitle(throwDesc)}", () => {`);
      lines.push(`    expect(() => {`);
      lines.push(`      // TODO: trigger error condition`);
      lines.push(`    }).toThrow();`);
      lines.push(`  });`);
      lines.push("");
    }
  }

  if (analysis.inputs.length === 0 && analysis.throws.length === 0) {
    lines.push(`  it("should work correctly", () => {`);
    lines.push(`    // How: ${analysis.how}`);
    lines.push(`    expect(true).toBe(false); // TODO: implement`);
    lines.push(`  });`);
    lines.push("");
  }

  lines.push(`});`);
  lines.push("");

  return {
    file_path: testFileName,
    content: lines.join("\n"),
    type: "unit",
    target_name: analysis.function_name,
  };
}

function generatePytestSkeleton(analysis: FunctionAnalysis): TestSkeleton {
  const testFileName = buildTestFileName(analysis, "test.py");
  const lines: string[] = [];

  lines.push(`"""Tests for ${analysis.function_name}"""`);
  lines.push(`# import from source module`);
  lines.push("");
  lines.push("");
  lines.push(`class Test${toPascalCase(analysis.function_name)}:`);
  lines.push(`    """${analysis.what}"""`);
  lines.push("");

  if (analysis.inputs.length > 0) {
    lines.push(`    def test_valid_inputs(self):`);
    lines.push(`        """Should accept valid inputs and return expected output."""`);
    for (const input of analysis.inputs) {
      lines.push(`        # ${input.name} (${input.type ?? "unknown"}): ${input.role}`);
    }
    lines.push(`        # Expected: ${analysis.outputs.meaning}`);
    lines.push(`        assert False  # TODO: implement`);
    lines.push("");
  }

  if (analysis.outputs.nullable) {
    lines.push(`    def test_nullable_return(self):`);
    lines.push(`        """Should handle None return case."""`);
    lines.push(`        assert False  # TODO: implement`);
    lines.push("");
  }

  if (analysis.throws.length > 0) {
    for (let i = 0; i < analysis.throws.length; i++) {
      lines.push(`    def test_error_case_${i + 1}(self):`);
      lines.push(`        """Should raise when: ${analysis.throws[i]}"""`);
      lines.push(`        # import pytest`);
      lines.push(`        # with pytest.raises(Exception):`);
      lines.push(`        #     call_function_with_invalid_input()`);
      lines.push(`        assert False  # TODO: implement`);
      lines.push("");
    }
  }

  if (analysis.inputs.length === 0 && analysis.throws.length === 0) {
    lines.push(`    def test_basic(self):`);
    lines.push(`        """Should work correctly."""`);
    lines.push(`        # How: ${analysis.how}`);
    lines.push(`        assert False  # TODO: implement`);
    lines.push("");
  }

  return {
    file_path: testFileName,
    content: lines.join("\n"),
    type: "unit",
    target_name: analysis.function_name,
  };
}

function generateVitestFeatureSkeleton(feature: EnhancedFeature): TestSkeleton {
  const testFileName = `test_feature_${sanitizeFileName(feature.name)}.test.ts`;
  const lines: string[] = [];

  lines.push(`import { describe, it, expect } from "vitest";`);
  lines.push("");
  lines.push(`/**`);
  lines.push(` * Integration tests for feature: ${feature.name}`);
  lines.push(` * ${feature.description}`);
  lines.push(` * Purpose: ${feature.purpose}`);
  lines.push(` */`);
  lines.push(`describe("Feature: ${feature.name}", () => {`);
  lines.push("");

  for (const constraint of feature.constraints) {
    lines.push(`  it("should satisfy constraint: ${escapeTestTitle(constraint)}", () => {`);
    lines.push(`    expect(true).toBe(false); // TODO: implement`);
    lines.push(`  });`);
    lines.push("");
  }

  if (feature.verification.length > 0) {
    lines.push(`  describe("verification checks", () => {`);
    for (const verification of feature.verification) {
      lines.push(`    it("${escapeTestTitle(verification.name)}", () => {`);
      lines.push(`      // Command: ${verification.command}`);
      lines.push(`      // Expected: ${verification.expect}`);
      lines.push(`      expect(true).toBe(false); // TODO: implement`);
      lines.push(`    });`);
      lines.push("");
    }
    lines.push(`  });`);
    lines.push("");
  }

  lines.push(`  it("should integrate ${feature.function_count} functions correctly", () => {`);
  lines.push(`    // Key files:`);
  for (const file of feature.key_files.slice(0, 5)) {
    lines.push(`    //   ${file}`);
  }
  lines.push(`    expect(true).toBe(false); // TODO: implement`);
  lines.push(`  });`);

  lines.push(`});`);
  lines.push("");

  return {
    file_path: testFileName,
    content: lines.join("\n"),
    type: "integration",
    target_name: feature.name,
  };
}

function generatePytestFeatureSkeleton(feature: EnhancedFeature): TestSkeleton {
  const testFileName = `test_feature_${sanitizeFileName(feature.name)}.py`;
  const lines: string[] = [];

  lines.push(`"""Integration tests for feature: ${feature.name}`);
  lines.push(`${feature.description}`);
  lines.push(`Purpose: ${feature.purpose}`);
  lines.push(`"""`);
  lines.push("");
  lines.push("");
  lines.push(`class TestFeature${toPascalCase(feature.name)}:`);
  lines.push(`    """${feature.description}"""`);
  lines.push("");

  for (let i = 0; i < feature.constraints.length; i++) {
    lines.push(`    def test_constraint_${i + 1}(self):`);
    lines.push(`        """Should satisfy: ${feature.constraints[i]}"""`);
    lines.push(`        assert False  # TODO: implement`);
    lines.push("");
  }

  lines.push(`    def test_integration(self):`);
  lines.push(`        """Should integrate ${feature.function_count} functions correctly."""`);
  for (const file of feature.key_files.slice(0, 5)) {
    lines.push(`        # Key file: ${file}`);
  }
  lines.push(`        assert False  # TODO: implement`);
  lines.push("");

  return {
    file_path: testFileName,
    content: lines.join("\n"),
    type: "integration",
    target_name: feature.name,
  };
}

function isInternalFunction(analysis: FunctionAnalysis): boolean {
  const name = analysis.function_name;
  if (name.startsWith("_") && !name.startsWith("__")) return true;
  return false;
}

function buildTestFileName(analysis: FunctionAnalysis, extension: string): string {
  const sourceBase = basename(analysis.file_path, ".ts")
    .replace(".tsx", "")
    .replace(".py", "")
    .replace(".js", "");
  return `test_${sanitizeFileName(sourceBase)}_${sanitizeFileName(analysis.function_name)}.${extension}`;
}

function buildImportPath(analysis: FunctionAnalysis): string {
  const withoutExt = analysis.file_path.replace(/\.(ts|tsx|js|jsx)$/, "");
  return `../../${withoutExt}`;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
}

function toPascalCase(name: string): string {
  return name
    .replace(/[-_](.)/g, (_, char) => char.toUpperCase())
    .replace(/^(.)/, (_, char) => char.toUpperCase());
}

function escapeTestTitle(text: string): string {
  return text.replace(/"/g, '\\"').replace(/\n/g, " ").slice(0, 100);
}

function countAssertionPlaceholders(content: string): number {
  const matches = content.match(/expect\(true\)\.toBe\(false\)|assert False/g);
  return matches?.length ?? 0;
}
