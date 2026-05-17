export function buildModularityPrompt(input) {
    return `You are a senior software architect evaluating code modularity. Analyze this function and return a JSON object.

## Function: ${input.function_name}
${input.class_name ? `Class: ${input.class_name}` : ""}
File: ${input.file_path}
Signature: ${input.signature}

## Source Code:
\`\`\`typescript
${input.source_body}
\`\`\`

## Imports Context:
${input.imports.slice(0, 10).join("\n")}

## Return a JSON object with this exact schema:
{
  "cohesion": {
    "score": <number 0-1, 1=highly cohesive>,
    "responsibilities": [<string array of distinct things this function does>],
    "single_purpose": <boolean>
  },
  "coupling": {
    "score": <number 0-1, 1=highly coupled (bad)>,
    "external_calls": [<function names called from other modules>],
    "import_dependencies": [<modules this depends on>],
    "global_accesses": [<global state accessed>],
    "self_contained": <boolean, could run with only its declared inputs?>
  },
  "hidden_dependencies": [
    {"kind": "<env_var|global|filesystem|singleton|network|time>", "reference": "<what>", "line": <number or null>}
  ],
  "interface_clarity": {
    "score": <number 0-1>,
    "all_params_typed": <boolean>,
    "return_type_declared": <boolean>,
    "uses_any": <boolean>,
    "minimal_params": <boolean>,
    "issues": [<string array of interface problems>]
  },
  "recommendations": [
    {"kind": "<extract_function|dependency_injection|split_module|simplify_interface|reduce_params>", "description": "<specific actionable advice>", "severity": "<low|medium|high>"}
  ],
  "contract": {
    "input_type": "<TypeScript interface definition as a string>",
    "output_type": "<TypeScript return type>",
    "contract_summary": "<one line: what goes in, what comes out>",
    "is_implicit": <boolean, different return shapes?>,
    "adapter_signature": "<wrapper function type signature or null>"
  },
  "is_god_function": <boolean>,
  "line_count": <number>
}

Be specific and concise. Each string field should be 1-2 sentences max.
Return ONLY valid JSON, no markdown fences, no explanation.`;
}
//# sourceMappingURL=prompt.js.map