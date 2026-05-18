import type { FunctionSignature } from "../../packages/ast/src/types.ts";

export function generateHeuristicReason(functionSignature: FunctionSignature): string {
  const name = functionSignature.name;
  const params = functionSignature.params.map((parameter) => parameter.name).join(", ");

  if (name.startsWith("get") || name.startsWith("fetch")) {
    const what = name.replace(/^(get|fetch)/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase();
    return `Retrieves ${what || "data"} based on ${params || "current state"}`;
  }
  if (name.startsWith("set") || name.startsWith("update")) {
    const what = name.replace(/^(set|update)/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase();
    return `Updates ${what || "value"} with provided ${params || "data"}`;
  }
  if (name.startsWith("parse")) {
    return `Parses ${params || "input"} into structured ${functionSignature.return_type ?? "data"}`;
  }
  if (name.startsWith("render")) {
    return `Renders ${params || "content"} into ${functionSignature.return_type ?? "output format"}`;
  }
  if (name.startsWith("init") || name.startsWith("create")) {
    return `Initializes ${(functionSignature.class_name ?? name.replace(/^(init|create)/, "").toLowerCase()) || "instance"}`;
  }
  if (name.startsWith("is") || name.startsWith("has") || name.startsWith("can")) {
    return `Checks whether ${name.replace(/^(is|has|can)/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase()}`;
  }
  if (name.startsWith("compute") || name.startsWith("calculate")) {
    return `Computes ${name.replace(/^(compute|calculate)/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase()} from ${params || "inputs"}`;
  }
  if (name.startsWith("write") || name.startsWith("save")) {
    return `Persists ${params || "data"} to storage`;
  }
  if (name.startsWith("read") || name.startsWith("load")) {
    return `Reads ${functionSignature.return_type ?? "data"} from ${params || "source"}`;
  }
  if (name.startsWith("extract")) {
    return `Extracts ${name.replace(/^extract/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase()} from ${params || "input"}`;
  }
  if (name.startsWith("build")) {
    return `Builds ${name.replace(/^build/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase()} from ${params || "components"}`;
  }
  if (name.startsWith("handle")) {
    return `Handles ${name.replace(/^handle/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase()} event`;
  }
  if (name.startsWith("collect")) {
    return `Collects ${name.replace(/^collect/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase()} from ${params || "source"}`;
  }
  if (name.startsWith("detect") || name.startsWith("find")) {
    return `Detects ${name.replace(/^(detect|find)/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase()} in ${params || "input"}`;
  }
  if (name.startsWith("generate")) {
    return `Generates ${name.replace(/^generate/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase()} from ${params || "input"}`;
  }
  if (name.startsWith("format")) {
    return `Formats ${name.replace(/^format/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase()} for ${params || "output"}`;
  }
  if (name.startsWith("validate") || name.startsWith("check")) {
    return `Validates ${name.replace(/^(validate|check)/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase()}`;
  }
  if (name.startsWith("run") || name.startsWith("execute")) {
    return `Executes ${name.replace(/^(run|execute)/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase()} operation`;
  }
  if (name.startsWith("walk")) {
    return `Walks ${name.replace(/^walk/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase()} structure recursively`;
  }
  if (functionSignature.is_method && functionSignature.class_name) {
    return `${functionSignature.class_name} method that processes ${params || "request"}`;
  }
  return `Handles ${name.replace(/([A-Z])/g, " $1").trim().toLowerCase()} operation`;
}
