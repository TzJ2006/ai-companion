const CONTROL_FLOW_RE = /\b(if|else|for|while|switch|case|try|catch)\b/g;
const KEYWORDS_TO_EXCLUDE = new Set([
    "if", "for", "while", "switch", "return", "throw", "catch", "typeof", "new",
]);
const BUILTIN_PREFIXES = ["console.", "Math.", "Object.", "Array.", "JSON.", "String.", "Number."];
function countNonBlankLines(source) {
    return source.split("\n").filter((line) => line.trim().length > 0).length;
}
function detectResponsibilities(source) {
    const responsibilities = [];
    const blocks = source.split(/\n\s*\n/);
    for (const block of blocks) {
        if (/\b(throw|return)\b/.test(block) && blocks.indexOf(block) < blocks.length / 2) {
            if (!responsibilities.includes("input validation")) {
                responsibilities.push("input validation");
            }
        }
        else if (/\.(map|filter|reduce)\s*\(/.test(block)) {
            if (!responsibilities.includes("data transformation")) {
                responsibilities.push("data transformation");
            }
        }
        else if (/\b(readFile|writeFile|fetch|axios|http\.|fs\.)\b/.test(block)) {
            if (!responsibilities.includes("I/O operation")) {
                responsibilities.push("I/O operation");
            }
        }
        else if (/\b(log|logger|console\.log|console\.warn|console\.error)\b/.test(block)) {
            if (!responsibilities.includes("logging/observability")) {
                responsibilities.push("logging/observability");
            }
        }
    }
    return responsibilities;
}
export function computeCohesion(source, _name) {
    const matches = source.match(CONTROL_FLOW_RE);
    const branchCount = matches ? matches.length : 0;
    const lineCount = countNonBlankLines(source);
    const score = Math.max(0, 1 - (branchCount * 2) / Math.max(lineCount, 1));
    const responsibilities = detectResponsibilities(source);
    const single_purpose = responsibilities.length <= 1;
    return { score, responsibilities, single_purpose };
}
function isBuiltinCall(name) {
    return BUILTIN_PREFIXES.some((prefix) => name.startsWith(prefix));
}
export function computeCoupling(source, imports) {
    const callPattern = /\b([a-zA-Z_]\w*)\s*\(/g;
    const externalCalls = [];
    let match;
    while ((match = callPattern.exec(source)) !== null) {
        const name = match[1];
        if (!KEYWORDS_TO_EXCLUDE.has(name) && !isBuiltinCall(name)) {
            if (!externalCalls.includes(name)) {
                externalCalls.push(name);
            }
        }
    }
    const globalPattern = /\b(process|global|globalThis|window)\.\w+/g;
    const globalAccesses = [];
    while ((match = globalPattern.exec(source)) !== null) {
        if (!globalAccesses.includes(match[0])) {
            globalAccesses.push(match[0]);
        }
    }
    const lineCount = countNonBlankLines(source);
    const score = Math.min(1, (externalCalls.length + globalAccesses.length) / Math.max(lineCount / 5, 1));
    const self_contained = externalCalls.length === 0 && globalAccesses.length === 0;
    return { score, external_calls: externalCalls, import_dependencies: imports, global_accesses: globalAccesses, self_contained };
}
export function detectHiddenDependencies(source) {
    const deps = [];
    const lines = source.split("\n");
    const patterns = [
        [/process\.env\.(\w+)/g, "env_var"],
        [/\b(global|globalThis|window)\.\w+/g, "global"],
        [/\b(readFile|writeFile|readdir|mkdir|existsSync|readFileSync|writeFileSync|appendFile|unlink|rmdir)\b/g, "filesystem"],
        [/\b(fetch|axios|http\.request|https\.request)\b/g, "network"],
        [/\b(Date\.now|new Date|performance\.now)\b/g, "time"],
        [/\bgetInstance\b|\.instance\b/g, "singleton"],
    ];
    for (const [regex, kind] of patterns) {
        for (let i = 0; i < lines.length; i++) {
            let lineMatch;
            const lineRegex = new RegExp(regex.source, regex.flags);
            while ((lineMatch = lineRegex.exec(lines[i])) !== null) {
                deps.push({ kind, reference: lineMatch[0], line: i + 1 });
            }
        }
    }
    return deps;
}
export function computeInterfaceClarity(input) {
    const issues = [];
    const all_params_typed = input.params.every((p) => p.type !== null);
    const return_type_declared = input.return_type !== null;
    const uses_any = /\bany\b/.test(input.source_body) || /\bany\b/.test(input.signature);
    const minimal_params = input.params.length <= 4;
    if (!all_params_typed) {
        for (const p of input.params) {
            if (p.type === null) {
                issues.push(`param '${p.name}' is untyped`);
            }
        }
    }
    if (!return_type_declared) {
        issues.push("return type not declared");
    }
    if (uses_any) {
        issues.push("uses any");
    }
    if (!minimal_params) {
        issues.push(`too many params (${input.params.length})`);
    }
    const score = Math.max(0, 1 - issues.length * 0.2);
    return { score, all_params_typed, return_type_declared, uses_any, minimal_params, issues };
}
export function generateRecommendations(input, cohesion, coupling, hiddenDeps, clarity) {
    const recs = [];
    const lineCount = countNonBlankLines(input.source_body);
    if (lineCount > 50 && cohesion.score < 0.5) {
        const resp = cohesion.responsibilities.join(", ") || "distinct concerns";
        recs.push({ kind: "extract_function", severity: "high", description: `Function has multiple responsibilities; extract [${resp}] into separate functions` });
    }
    if (coupling.score > 0.7) {
        recs.push({ kind: "dependency_injection", severity: "medium", description: "High coupling; inject dependencies via parameters instead of importing directly" });
    }
    if (hiddenDeps.length > 2) {
        recs.push({ kind: "dependency_injection", severity: "high", description: "Multiple hidden dependencies detected; make them explicit parameters" });
    }
    if (clarity.score < 0.4) {
        recs.push({ kind: "simplify_interface", severity: "medium", description: "Interface is unclear; add type annotations and reduce parameter count" });
    }
    if (input.params.length > 5) {
        recs.push({ kind: "reduce_params", severity: "low", description: "Consider grouping parameters into an options/config object" });
    }
    if (lineCount > 100) {
        recs.push({ kind: "extract_function", severity: "high", description: "Function exceeds 100 lines; split into smaller units" });
    }
    return recs;
}
export function generateContract(input, source) {
    const paramEntries = input.params
        .map((p) => `${p.name}: ${p.type ?? "unknown"}`)
        .join("; ");
    const input_type = `{ ${paramEntries} }`;
    const output_type = input.return_type ?? "unknown";
    const paramList = input.params
        .map((p) => `${p.name}: ${p.type ?? "unknown"}`)
        .join(", ");
    const contract_summary = `Takes (${paramList}) and returns ${output_type}`;
    const hasObjectReturn = /return\s*\{/.test(source);
    const hasNullishReturn = /return\s+(null|undefined|\[\])/.test(source);
    const is_implicit = hasObjectReturn && hasNullishReturn;
    const adapter_signature = input.params.length > 0
        ? `(input: ${input_type}) => ${output_type}`
        : null;
    return { input_type, output_type, contract_summary, is_implicit, adapter_signature };
}
export function analyzeModularityHeuristic(input) {
    const source = input.source_body;
    const cohesion = computeCohesion(source, input.function_name);
    const coupling = computeCoupling(source, input.imports);
    const hidden_dependencies = detectHiddenDependencies(source);
    const interface_clarity = computeInterfaceClarity(input);
    const recommendations = generateRecommendations(input, cohesion, coupling, hidden_dependencies, interface_clarity);
    const contract = generateContract(input, source);
    const line_count = countNonBlankLines(source);
    const is_god_function = line_count > 50 && !cohesion.single_purpose;
    return {
        function_hash: input.function_hash,
        file_path: input.file_path,
        function_name: input.function_name,
        class_name: input.class_name,
        cohesion,
        coupling,
        hidden_dependencies,
        interface_clarity,
        recommendations,
        contract,
        is_god_function,
        line_count,
        analyzed_at: new Date().toISOString(),
        analysis_source: "heuristic",
    };
}
//# sourceMappingURL=heuristic.js.map