import { createHash } from "node:crypto";
import type { FunctionSignature, FunctionIdentity } from "./types.js";

export function computeFunctionIdentity(
  filePath: string,
  fn: FunctionSignature
): FunctionIdentity {
  const paramSignature = fn.params
    .filter((p) => p.name !== "self" && p.name !== "cls")
    .map((p) => `${p.name}:${p.type ?? "any"}`)
    .join(",");

  const identityString = [
    filePath,
    fn.class_name ?? "",
    fn.name,
    paramSignature,
  ].join("::");

  const hash = createHash("sha256")
    .update(identityString)
    .digest("hex")
    .slice(0, 16);

  return {
    hash,
    file_path: filePath,
    function_name: fn.name,
    class_name: fn.class_name,
    param_signature: paramSignature,
  };
}
