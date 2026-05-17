const JSON_SCHEMA = `{
  "function_hash": "<string: the provided function_hash>",
  "file_path": "<string: the provided file_path>",
  "function_name": "<string: the provided function_name>",
  "class_name": "<string|null: the provided class_name>",
  "why": "<string: 1-2 sentences explaining the purpose/motivation for this function>",
  "what": "<string: 1-2 sentences describing what the function does>",
  "how": "<string: 1-2 sentences summarizing the implementation approach>",
  "inputs": [
    {
      "name": "<string: parameter name>",
      "type": "<string|null: parameter type>",
      "role": "<string: what this parameter represents>",
      "constraints": "<string: any constraints or expectations>"
    }
  ],
  "outputs": {
    "type": "<string|null: return type>",
    "meaning": "<string: what the return value represents>",
    "nullable": "<boolean: whether the return can be null/undefined>"
  },
  "throws": ["<string: description of each error/exception that can be thrown>"],
  "depends_on": ["<string: names of functions/methods called within the body>"]
}`;
export function buildAnalysisPrompt(input) {
    const sections = [];
    sections.push("Analyze the following function and return a JSON object describing it.");
    sections.push("Be concise: each string field should be 1-2 sentences maximum, specific and direct.");
    sections.push("");
    if (input.imports.length > 0) {
        sections.push("## Imports (for context)");
        sections.push("```");
        sections.push(input.imports.join("\n"));
        sections.push("```");
        sections.push("");
    }
    if (input.class_context) {
        sections.push("## Class Context");
        sections.push(`This is a method of: ${input.class_context}`);
        sections.push("");
    }
    sections.push("## Function");
    sections.push(`File: ${input.file_path}`);
    sections.push(`Signature: ${input.signature}`);
    if (input.class_name) {
        sections.push(`Class: ${input.class_name}`);
    }
    sections.push("");
    sections.push("```");
    sections.push(input.source_body);
    sections.push("```");
    sections.push("");
    sections.push("## Required Output");
    sections.push("Return ONLY valid JSON (no markdown fences, no explanation) matching this schema:");
    sections.push(JSON_SCHEMA);
    sections.push("");
    sections.push(`Use function_hash: "${input.function_hash}"`);
    sections.push(`Use file_path: "${input.file_path}"`);
    sections.push(`Use function_name: "${input.function_name}"`);
    sections.push(`Use class_name: ${input.class_name ? `"${input.class_name}"` : "null"}`);
    return sections.join("\n");
}
//# sourceMappingURL=prompt.js.map