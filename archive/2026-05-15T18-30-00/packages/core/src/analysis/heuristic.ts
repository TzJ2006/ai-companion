import type { AnalysisInput, AnalysisParam, FunctionAnalysis } from "./types.js";

const PURPOSE_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/^parse/, "Transforms raw input into structured data"],
  [/^validate/, "Ensures data integrity before further processing"],
  [/^render/, "Produces visual output for display"],
  [/^compute|^calc/, "Calculates derived values from inputs"],
  [/^get|^fetch|^load|^read/, "Retrieves data from a source"],
  [/^set|^update|^write|^save/, "Persists or updates data in a store"],
  [/^create|^build|^make|^generate/, "Constructs a new instance or artifact"],
  [/^delete|^remove|^destroy/, "Removes data or resources"],
  [/^transform|^convert|^map/, "Converts data from one format to another"],
  [/^filter|^select/, "Narrows a collection based on criteria"],
  [/^sort|^order/, "Arranges items in a specific sequence"],
  [/^init|^setup|^configure/, "Prepares the system or component for use"],
  [/^handle|^process/, "Processes an event or request"],
  [/^check|^is|^has/, "Evaluates a condition and returns a boolean"],
  [/^format|^stringify/, "Formats data into a human-readable representation"],
  [/^merge|^combine|^join/, "Combines multiple inputs into a unified result"],
  [/^split|^partition/, "Divides input into separate parts"],
  [/^emit|^dispatch|^publish/, "Sends a signal or event to listeners"],
  [/^subscribe|^listen|^on/, "Registers a handler for future events"],
];

const PARAM_ROLE_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/path|file|dir/, "filesystem location"],
  [/config|options|opts|settings/, "configuration options"],
  [/callback|handler|listener|fn/, "callback function"],
  [/name|label|title/, "identifier or label"],
  [/data|payload|body|content/, "data payload"],
  [/id|key|hash/, "unique identifier"],
  [/index|offset|position/, "positional index"],
  [/count|limit|max|min|size/, "numeric boundary"],
  [/filter|query|criteria/, "filtering criteria"],
  [/format|pattern|template/, "format specification"],
  [/source|input|from/, "input source"],
  [/target|output|dest|to/, "output destination"],
];

function inferWhy(input: AnalysisInput): string {
  const name = input.function_name.toLowerCase();
  for (const [pattern, purpose] of PURPOSE_PATTERNS) {
    if (pattern.test(name)) {
      return purpose;
    }
  }
  if (input.class_name) {
    return `Provides behavior for ${input.class_name}`;
  }
  return "Performs a domain-specific operation";
}

function inferWhat(input: AnalysisInput): string {
  const returnMatch = input.signature.match(/\)\s*(?:->|:)\s*(.+?)$/);
  const returnType = returnMatch ? returnMatch[1].trim() : null;

  const nameWords = input.function_name
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .trim()
    .toLowerCase();

  if (returnType) {
    return `${capitalizeFirst(nameWords)} and returns ${returnType}`;
  }
  return capitalizeFirst(nameWords);
}

function inferHow(input: AnalysisInput): string {
  const signals: string[] = [];

  if (/async\s/.test(input.signature) || /await\s/.test(input.source_body)) {
    signals.push("asynchronous execution");
  }
  if (/for\s*\(|for\s+.*\s+of|\.forEach|while\s*\(/.test(input.source_body)) {
    signals.push("iteration");
  }
  if (/\.map\s*\(|\.filter\s*\(|\.reduce\s*\(/.test(input.source_body)) {
    signals.push("functional transformations");
  }
  if (/if\s*\(|switch\s*\(|\?\s/.test(input.source_body)) {
    signals.push("conditional logic");
  }
  if (/try\s*\{/.test(input.source_body)) {
    signals.push("error handling");
  }
  if (/new\s+\w+/.test(input.source_body)) {
    signals.push("object construction");
  }

  if (signals.length === 0) {
    return "Direct computation with straightforward logic";
  }
  return `Uses ${signals.join(", ")}`;
}

function inferParamRole(paramName: string): string {
  const lower = paramName.toLowerCase();
  for (const [pattern, role] of PARAM_ROLE_PATTERNS) {
    if (pattern.test(lower)) {
      return role;
    }
  }
  return "input value";
}

function inferParamConstraints(paramType: string | null): string {
  if (!paramType) {
    return "no type constraint specified";
  }
  const lower = paramType.toLowerCase();
  if (lower === "string") return "non-empty string expected";
  if (lower === "number" || lower === "int" || lower === "float") return "numeric value";
  if (lower === "boolean" || lower === "bool") return "true or false";
  if (lower.includes("[]") || lower.includes("array")) return "array, may be empty";
  if (lower.includes("optional") || lower.includes("?") || lower.includes("null")) {
    return "optional, may be null or undefined";
  }
  return `must conform to ${paramType}`;
}

function extractParams(input: AnalysisInput): AnalysisParam[] {
  const paramSection = input.signature.match(/\(([^)]*)\)/);
  if (!paramSection || !paramSection[1].trim()) {
    return [];
  }

  const rawParams = paramSection[1].split(",").map((p) => p.trim());
  return rawParams.map((raw) => {
    const [namePart, typePart] = raw.includes(":")
      ? raw.split(":").map((s) => s.trim())
      : [raw.replace(/^\w+\s+/, ""), null];

    const name = namePart.replace(/^\.{3}/, "").replace(/\?$/, "").trim();
    const type = typePart ? typePart.trim() : null;

    return {
      name,
      type,
      role: inferParamRole(name),
      constraints: inferParamConstraints(type),
    };
  });
}

function extractThrows(sourceBody: string): string[] {
  const throwMatches = sourceBody.match(/throw\s+new\s+(\w+)\s*\([^)]*\)/g);
  if (!throwMatches) {
    return /throw\s/.test(sourceBody) ? ["Throws an error on failure"] : [];
  }
  return throwMatches.map((m) => {
    const errorType = m.match(/throw\s+new\s+(\w+)/);
    return errorType ? `Throws ${errorType[1]}` : "Throws an error";
  });
}

function extractDependencies(sourceBody: string): string[] {
  const callPattern = /(?<!\w)([a-zA-Z_]\w*)\s*\(/g;
  const calls = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = callPattern.exec(sourceBody)) !== null) {
    const name = match[1];
    const keywords = new Set([
      "if", "for", "while", "switch", "catch", "return",
      "throw", "new", "typeof", "instanceof", "await",
      "function", "class", "import", "export",
    ]);
    if (!keywords.has(name)) {
      calls.add(name);
    }
  }

  return [...calls];
}

function inferOutputType(signature: string): { type: string | null; nullable: boolean } {
  const returnMatch = signature.match(/\)\s*(?:->|:)\s*(.+?)$/);
  if (!returnMatch) {
    return { type: null, nullable: false };
  }
  const type = returnMatch[1].trim();
  const nullable = /null|undefined|None|\?/.test(type);
  return { type, nullable };
}

function capitalizeFirst(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function analyzeHeuristic(input: AnalysisInput): FunctionAnalysis {
  const { type, nullable } = inferOutputType(input.signature);

  return {
    function_hash: input.function_hash,
    file_path: input.file_path,
    function_name: input.function_name,
    class_name: input.class_name,
    why: inferWhy(input),
    what: inferWhat(input),
    how: inferHow(input),
    inputs: extractParams(input),
    outputs: {
      type,
      meaning: type ? `Returns ${type}` : "No explicit return value",
      nullable,
    },
    throws: extractThrows(input.source_body),
    depends_on: extractDependencies(input.source_body),
    analyzed_at: new Date().toISOString(),
    analysis_source: "heuristic",
  };
}
