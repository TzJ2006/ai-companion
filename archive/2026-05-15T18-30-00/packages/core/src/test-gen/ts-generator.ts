import type { FunctionSignature, ParsedModule } from "@aidev/ast";
import { readFile } from "node:fs/promises";

export interface TsTestGenConfig {
  test_framework: "vitest" | "jest";
  output_dir: string;
  include_source_body: boolean;
  llm_enhance: boolean;
}

export interface GeneratedTsTest {
  function_name: string;
  class_name: string | null;
  source_file: string;
  test_file_path: string;
  test_content: string;
  generated_at: string;
}

export function generateTestSkeleton(
  mod: ParsedModule,
  config: TsTestGenConfig
): GeneratedTsTest[] {
  const results: GeneratedTsTest[] = [];
  const timestamp = new Date().toISOString();

  for (const fn of mod.functions) {
    const test = buildFunctionTest(fn, mod.file_path, config);
    results.push({
      function_name: fn.name,
      class_name: null,
      source_file: mod.file_path,
      test_file_path: buildTestPath(mod.file_path, fn.name, null, config),
      test_content: test,
      generated_at: timestamp,
    });
  }

  for (const cls of mod.classes) {
    const classTest = buildClassTest(cls.name, cls.methods, mod.file_path, config);
    results.push({
      function_name: cls.name,
      class_name: cls.name,
      source_file: mod.file_path,
      test_file_path: buildTestPath(mod.file_path, cls.name, null, config),
      test_content: classTest,
      generated_at: timestamp,
    });
  }

  return results;
}

function buildFunctionTest(
  fn: FunctionSignature,
  sourceFile: string,
  config: TsTestGenConfig
): string {
  const importPath = sourceFile.replace(/\\/g, "/").replace(/\.ts$/, ".js");
  const lines: string[] = [];
  const fw = config.test_framework;

  lines.push(`import { describe, it, expect } from "${fw}";`);
  lines.push(`import { ${fn.name} } from "../../${importPath}";`);
  lines.push("");
  lines.push(`describe("${fn.name}", () => {`);

  const testCases = inferTestCases(fn);
  for (const tc of testCases) {
    lines.push(`  it("${tc.description}", ${fn.is_async ? "async " : ""}() => {`);
    lines.push(`    ${tc.body}`);
    lines.push("  });");
    lines.push("");
  }

  lines.push("});");
  return lines.join("\n");
}

function buildClassTest(
  className: string,
  methods: FunctionSignature[],
  sourceFile: string,
  config: TsTestGenConfig
): string {
  const importPath = sourceFile.replace(/\\/g, "/").replace(/\.ts$/, ".js");
  const lines: string[] = [];
  const fw = config.test_framework;

  lines.push(`import { describe, it, expect, beforeEach } from "${fw}";`);
  lines.push(`import { ${className} } from "../../${importPath}";`);
  lines.push("");
  lines.push(`describe("${className}", () => {`);

  const constructorMethod = methods.find(m => m.name === "constructor");
  if (constructorMethod) {
    const args = constructorMethod.params
      .filter(p => p.name !== "this")
      .map(p => inferMockValue(p.name, p.type))
      .join(", ");
    lines.push(`  let instance: ${className};`);
    lines.push("");
    lines.push("  beforeEach(() => {");
    lines.push(`    instance = new ${className}(${args});`);
    lines.push("  });");
    lines.push("");
  }

  for (const method of methods) {
    if (method.name === "constructor") continue;
    if (method.name.startsWith("_") || method.name.startsWith("#")) continue;

    const testCases = inferTestCases(method);
    lines.push(`  describe("${method.name}", () => {`);
    for (const tc of testCases) {
      const asyncPrefix = method.is_async ? "async " : "";
      lines.push(`    it("${tc.description}", ${asyncPrefix}() => {`);
      lines.push(`      ${tc.body}`);
      lines.push("    });");
      lines.push("");
    }
    lines.push("  });");
    lines.push("");
  }

  lines.push("});");
  return lines.join("\n");
}

interface TestCase {
  description: string;
  body: string;
}

function inferTestCases(fn: FunctionSignature): TestCase[] {
  const cases: TestCase[] = [];
  const isAsync = fn.is_async;
  const awaitPrefix = isAsync ? "await " : "";
  const isMethod = fn.is_method;
  const callTarget = isMethod ? `instance.${fn.name}` : fn.name;

  const args = fn.params
    .filter(p => p.name !== "this" && p.name !== "self" && p.name !== "cls")
    .map(p => inferMockValue(p.name, p.type));

  cases.push({
    description: `should execute without throwing`,
    body: `const result = ${awaitPrefix}${callTarget}(${args.join(", ")});\n    expect(result).toBeDefined();`,
  });

  if (fn.return_type) {
    const returnCheck = inferReturnTypeCheck(fn.return_type);
    if (returnCheck) {
      cases.push({
        description: `should return correct type (${fn.return_type})`,
        body: `const result = ${awaitPrefix}${callTarget}(${args.join(", ")});\n    ${returnCheck}`,
      });
    }
  }

  if (inferCanThrow(fn)) {
    const badArgs = fn.params
      .filter(p => p.name !== "this" && p.name !== "self" && p.name !== "cls")
      .map(p => inferBadValue(p.name, p.type));

    if (isAsync) {
      cases.push({
        description: `should throw on invalid input`,
        body: `await expect(${callTarget}(${badArgs.join(", ")})).rejects.toThrow();`,
      });
    } else {
      cases.push({
        description: `should throw on invalid input`,
        body: `expect(() => ${callTarget}(${badArgs.join(", ")})).toThrow();`,
      });
    }
  }

  if (fn.name.startsWith("get") || fn.name.startsWith("is") || fn.name.startsWith("has")) {
    cases.push({
      description: `should be idempotent (same input → same output)`,
      body: `const r1 = ${awaitPrefix}${callTarget}(${args.join(", ")});\n    const r2 = ${awaitPrefix}${callTarget}(${args.join(", ")});\n    expect(r1).toEqual(r2);`,
    });
  }

  if (fn.name.startsWith("init") || fn.name.startsWith("setup") || fn.name.startsWith("create")) {
    cases.push({
      description: `should be callable multiple times safely`,
      body: `${awaitPrefix}${callTarget}(${args.join(", ")});\n    const result = ${awaitPrefix}${callTarget}(${args.join(", ")});\n    expect(result).toBeDefined();`,
    });
  }

  return cases;
}

function inferMockValue(name: string, type: string | null): string {
  if (!type) return inferFromName(name);

  const t = type.toLowerCase().replace(/\s/g, "");
  if (t === "string") return `"test-${name}"`;
  if (t === "number" || t === "int" || t === "float") return "42";
  if (t === "boolean" || t === "bool") return "true";
  if (t.startsWith("string[]") || t === "array<string>") return `["a", "b"]`;
  if (t.startsWith("number[]") || t === "array<number>") return "[1, 2, 3]";
  if (t.includes("[]") || t.startsWith("array")) return "[]";
  if (t.includes("map") || t.includes("record")) return "{}";
  if (t.includes("promise")) return inferMockValue(name, t.replace(/promise<(.+)>/, "$1"));
  if (t === "void" || t === "undefined") return "undefined";
  if (t === "null") return "null";

  return inferFromName(name);
}

export function inferFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("path") || lower.includes("file") || lower.includes("dir")) return `"/tmp/test"`;
  if (lower.includes("name") || lower.includes("label") || lower.includes("title")) return `"test-name"`;
  if (lower.includes("id") || lower.includes("hash")) return `"abc123"`;
  if (lower.includes("count") || lower.includes("num") || lower.includes("index") || lower.includes("limit")) return "10";
  if (lower.includes("flag") || lower.includes("enabled") || lower.includes("active")) return "true";
  if (lower.includes("options") || lower.includes("config") || lower.includes("opts")) return "{}";
  if (lower.includes("items") || lower.includes("list") || lower.includes("entries")) return "[]";
  if (lower.includes("callback") || lower.includes("fn") || lower.includes("handler")) return "() => {}";
  if (lower.includes("source") || lower.includes("content") || lower.includes("text")) return `"test content"`;
  return `undefined /* TODO: provide ${name} */`;
}

function inferReturnTypeCheck(returnType: string): string | null {
  const t = returnType.toLowerCase().replace(/\s/g, "");
  if (t === "string") return `expect(typeof result).toBe("string");`;
  if (t === "number") return `expect(typeof result).toBe("number");`;
  if (t === "boolean") return `expect(typeof result).toBe("boolean");`;
  if (t === "void") return null;
  if (t.includes("[]") || t.startsWith("array")) return `expect(Array.isArray(result)).toBe(true);`;
  if (t === "null") return `expect(result).toBeNull();`;
  return `expect(result).toBeDefined();`;
}

function inferCanThrow(fn: FunctionSignature): boolean {
  if (fn.docstring?.toLowerCase().includes("throw")) return true;
  if (fn.docstring?.toLowerCase().includes("error")) return true;
  if (fn.name.includes("parse") || fn.name.includes("Parse")) return true;
  if (fn.name.includes("validate") || fn.name.includes("Validate")) return true;
  if (fn.name.includes("read") || fn.name.includes("Read")) return true;
  if (fn.name.includes("load") || fn.name.includes("Load")) return true;
  const hasNullableParams = fn.params.some(p =>
    p.type?.includes("null") || (!p.type && !p.default_value)
  );
  return hasNullableParams;
}

function inferBadValue(_name: string, type: string | null): string {
  if (!type) return "null as any";
  const t = type.toLowerCase();
  if (t === "string") return "null as any";
  if (t === "number") return `"not-a-number" as any`;
  if (t.includes("[]")) return "null as any";
  return "undefined as any";
}

function buildTestPath(
  sourceFile: string,
  name: string,
  _className: string | null,
  config: TsTestGenConfig
): string {
  const baseName = sourceFile.replace(/\\/g, "/").split("/").pop()?.replace(/\.ts$/, "") ?? "module";
  return `${config.output_dir}/test_${baseName}_${name}.test.ts`;
}

export function buildLlmEnhancePrompt(
  fn: FunctionSignature,
  sourceBody: string,
  skeleton: string
): string {
  return `You are a senior test engineer. Given the function below and its test skeleton, fill in meaningful assertions and test values.

## Source Function
\`\`\`typescript
${sourceBody}
\`\`\`

## Function Signature
${fn.is_async ? "async " : ""}function ${fn.class_name ? fn.class_name + "." : ""}${fn.name}(${fn.params.map(p => `${p.name}: ${p.type ?? "any"}`).join(", ")}): ${fn.return_type ?? "unknown"}

## Current Test Skeleton
\`\`\`typescript
${skeleton}
\`\`\`

## Instructions
- Replace placeholder values with realistic inputs
- Replace generic assertions with specific expected outputs
- Add edge cases you can infer from the implementation
- Keep using vitest (describe, it, expect)
- Output ONLY the complete test file, no explanations

\`\`\`typescript
`;
}
