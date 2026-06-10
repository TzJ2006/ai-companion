import { readFile } from "node:fs/promises";
import { parseDocument } from "yaml";
import type {
  DagGraph,
  FnNode,
  SubagentContext,
  ModuleInterface,
  CompletedDep,
} from "./types.js";

export async function buildSubagentContext(
  fnId: string,
  graph: DagGraph,
  eclPath: string
): Promise<SubagentContext> {
  const fn = graph.nodes.find((n) => n.id === fnId);
  if (!fn) {
    throw new Error(`FN not found in graph: ${fnId}`);
  }

  const completedDeps: CompletedDep[] = [];
  for (const depId of fn.depends_on) {
    const dep = graph.nodes.find((n) => n.id === depId);
    if (dep && dep.status === "done") {
      completedDeps.push({
        fnId: dep.id,
        outputFile: dep.output.file,
        outputSymbol: dep.output.symbol,
      });
    }
  }

  let moduleInterface: ModuleInterface | null = null;
  try {
    const content = await readFile(eclPath, "utf-8");
    const doc = parseDocument(content);
    const parsed = doc.toJSON() as Record<string, unknown>;
    const modules = parsed.modules as Array<Record<string, unknown>> | undefined;
    if (modules && Array.isArray(modules)) {
      const parentMod = modules.find((m) => m.id === fn.parent);
      if (parentMod) {
        moduleInterface = {
          name: (parentMod.name as string) || "",
          entry_point: (parentMod.entry_point as string) || "index.ts",
          public_interface: (parentMod.public_interface as ModuleInterface["public_interface"]) || [],
        };
      }
    }
  } catch {
    // ECL read failure is non-fatal for context building
  }

  return {
    fn,
    outputFile: fn.output.file,
    outputSymbol: fn.output.symbol,
    moduleInterface,
    completedDeps,
  };
}

export function formatSubagentPrompt(context: SubagentContext): string {
  const { fn, outputFile, outputSymbol, moduleInterface, completedDeps } = context;

  const lines: string[] = [];
  lines.push(`## Task: Implement ${fn.name}`);
  lines.push("");
  lines.push(`**Description:** ${fn.description}`);
  lines.push("");
  lines.push(`**Output file:** ${outputFile}`);
  lines.push(`**Export symbol:** ${outputSymbol}`);
  lines.push("");

  if (fn.input_interface.length > 0) {
    lines.push("**Input interface:**");
    for (const input of fn.input_interface) {
      lines.push(`- ${input.name}: ${input.type}`);
    }
    lines.push("");
  }

  lines.push(`**Return type:** ${fn.output_interface.type}`);
  if (fn.output_interface.error_cases.length > 0) {
    lines.push("**Error cases:**");
    for (const err of fn.output_interface.error_cases) {
      lines.push(`- ${err.type}: ${err.when}`);
    }
  }
  lines.push("");

  if (fn.constraints.length > 0) {
    lines.push("**Constraints:**");
    for (const c of fn.constraints) {
      lines.push(`- ${c}`);
    }
    lines.push("");
  }

  if (moduleInterface) {
    lines.push(`**Module:** ${moduleInterface.name} (entry: ${moduleInterface.entry_point})`);
    if (moduleInterface.public_interface.length > 0) {
      lines.push("**Module public interface:**");
      for (const pi of moduleInterface.public_interface) {
        lines.push(`- ${pi.name}${pi.signature ? `: ${pi.signature}` : ""}`);
      }
    }
    lines.push("");
  }

  if (completedDeps.length > 0) {
    lines.push("**Completed dependencies (available for import):**");
    for (const dep of completedDeps) {
      lines.push(`- ${dep.outputSymbol} from "${dep.outputFile}"`);
    }
    lines.push("");
  }

  lines.push("**Verification command:**");
  lines.push(`\`${fn.verify.command}\``);
  lines.push("");
  lines.push("After implementing, run the verification command to confirm correctness.");

  return lines.join("\n");
}
