import type { FunctionSignature } from "@aidev/ast";
import type { ChangeRecord } from "@aidev/history";

export interface TestGenerationConfig {
  llm_provider: "claude" | "openai" | "local";
  api_key?: string;
  model?: string;
  test_framework: "pytest";
  output_dir: string;
}

export interface GeneratedTest {
  function_name: string;
  function_hash: string;
  test_file_path: string;
  test_content: string;
  test_type: "normal" | "edge_case";
  generated_at: string;
}

export function buildTestPrompt(
  fn: FunctionSignature,
  change: ChangeRecord | null,
  testType: "normal" | "edge_case"
): string {
  const paramDesc = fn.params
    .map((p) => `  - ${p.name}: ${p.type ?? "Any"}${p.default_value ? ` = ${p.default_value}` : ""}`)
    .join("\n");

  const contextSection = change
    ? `\n## Change Context\nReason for modification: ${change.reason}\nNew code:\n\`\`\`python\n${change.new_content}\n\`\`\`\n`
    : "";

  const typeInstruction = testType === "normal"
    ? "Write 3-5 test cases covering the happy path and typical usage patterns."
    : "Write 3-5 test cases covering edge cases: empty inputs, None values, type errors, boundary conditions, large inputs.";

  return `Generate pytest test cases for the following Python function.

## Function Signature
\`\`\`
${fn.is_async ? "async " : ""}def ${fn.class_name ? fn.class_name + "." : ""}${fn.name}(${fn.params.map((p) => p.name).join(", ")})${fn.return_type ? " -> " + fn.return_type : ""}
\`\`\`

## Parameters
${paramDesc}

## Return Type
${fn.return_type ?? "Not specified"}

${fn.docstring ? `## Docstring\n${fn.docstring}\n` : ""}
${contextSection}
## Instructions
${typeInstruction}

Output ONLY valid Python test code using pytest. Include necessary imports.
Use descriptive test function names prefixed with \`test_\`.
Each test should have a clear assertion.`;
}

export function buildTestFilePath(
  config: TestGenerationConfig,
  fn: FunctionSignature,
  sourceFilePath: string
): string {
  const fileName = sourceFilePath.split("/").pop()?.replace(".py", "") ?? "module";
  const testFileName = fn.class_name
    ? `test_${fileName}_${fn.class_name}_${fn.name}.py`
    : `test_${fileName}_${fn.name}.py`;
  return `${config.output_dir}/${testFileName}`;
}

export function parseTestResponse(llmResponse: string): string {
  const codeBlockMatch = llmResponse.match(/```python\n([\s\S]*?)```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  if (llmResponse.includes("import") && llmResponse.includes("def test_")) {
    return llmResponse.trim();
  }
  return llmResponse.trim();
}
