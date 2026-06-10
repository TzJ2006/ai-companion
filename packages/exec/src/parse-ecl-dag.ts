import { readFile } from "node:fs/promises";
import { parseDocument } from "yaml";
import type { FnNode, DagGraph } from "./types.js";
import { EclParseError } from "./types.js";

const REQUIRED_FN_FIELDS = [
  "id",
  "name",
  "depends_on",
  "output",
  "verify",
  "status",
] as const;

export function validateFnFields(rawFn: Record<string, unknown>): FnNode {
  for (const field of REQUIRED_FN_FIELDS) {
    if (rawFn[field] === undefined || rawFn[field] === null) {
      throw new EclParseError(`FN missing required field: ${field}`);
    }
  }

  const output = rawFn.output as Record<string, unknown> | undefined;
  if (!output || typeof output !== "object") {
    throw new EclParseError(`FN ${rawFn.id}: missing output object`);
  }
  if (!output.file) {
    throw new EclParseError(`FN ${rawFn.id}: missing output.file`);
  }
  if (!output.symbol) {
    throw new EclParseError(`FN ${rawFn.id}: missing output.symbol`);
  }

  const verify = rawFn.verify as Record<string, unknown> | undefined;
  if (!verify || typeof verify !== "object") {
    throw new EclParseError(`FN ${rawFn.id}: missing verify object`);
  }
  if (!verify.command) {
    throw new EclParseError(`FN ${rawFn.id}: missing verify.command`);
  }
  if (!verify.pass_condition) {
    throw new EclParseError(`FN ${rawFn.id}: missing verify.pass_condition`);
  }

  if (!Array.isArray(rawFn.depends_on)) {
    throw new EclParseError(`FN ${rawFn.id}: depends_on must be an array`);
  }

  return {
    id: rawFn.id as string,
    name: (rawFn.name as string) || "",
    parent: (rawFn.parent as string) || "",
    visibility: (rawFn.visibility as string) || "public",
    description: (rawFn.description as string) || "",
    input_interface: (rawFn.input_interface as FnNode["input_interface"]) || [],
    output_interface: (rawFn.output_interface as FnNode["output_interface"]) || { type: "unknown", error_cases: [] },
    side_effects: (rawFn.side_effects as string[]) || [],
    dependencies: (rawFn.dependencies as string[]) || [],
    constraints: (rawFn.constraints as string[]) || [],
    test_cases: (rawFn.test_cases as FnNode["test_cases"]) || [],
    depends_on: rawFn.depends_on as string[],
    enables: (rawFn.enables as string[]) || [],
    output: {
      file: output.file as string,
      symbol: output.symbol as string,
    },
    verify: {
      command: verify.command as string,
      pass_condition: verify.pass_condition as string,
    },
    status: rawFn.status as FnNode["status"],
  };
}

export async function parseEclDag(eclPath: string): Promise<DagGraph> {
  let content: string;
  try {
    content = await readFile(eclPath, "utf-8");
  } catch {
    throw new EclParseError(`ECL file not found: ${eclPath}`);
  }

  const doc = parseDocument(content);
  if (doc.errors.length > 0) {
    throw new EclParseError(`Invalid YAML: ${doc.errors[0].message}`);
  }

  const parsed = doc.toJSON() as Record<string, unknown>;
  const rawFunctions = parsed.functions;

  if (!rawFunctions || !Array.isArray(rawFunctions) || rawFunctions.length === 0) {
    throw new EclParseError("ECL file has no functions section or it is empty");
  }

  const nodes: FnNode[] = [];
  const nodeIds = new Set<string>();

  for (const rawFn of rawFunctions) {
    const node = validateFnFields(rawFn as Record<string, unknown>);
    nodes.push(node);
    nodeIds.add(node.id);
  }

  for (const node of nodes) {
    for (const dep of node.depends_on) {
      if (!nodeIds.has(dep)) {
        throw new EclParseError(
          `FN ${node.id}: depends_on references unknown FN: ${dep}`
        );
      }
    }
  }

  const edges = new Map<string, string[]>();
  for (const node of nodes) {
    edges.set(node.id, node.depends_on);
  }

  return { nodes, edges };
}
