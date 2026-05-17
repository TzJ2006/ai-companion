import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SEARCH_DEPTHS = [
  "../node_modules",
  "../../../node_modules",
  "../../../../node_modules",
];

export function resolveWasmPath(packageName: string, wasmFileName: string): string {
  const candidates = SEARCH_DEPTHS.map((depth) =>
    resolve(__dirname, depth, packageName, wasmFileName)
  );

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  throw new Error(
    `${wasmFileName} not found. Searched:\n${candidates.join("\n")}`
  );
}
