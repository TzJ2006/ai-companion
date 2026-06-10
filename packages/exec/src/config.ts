import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExecConfig } from "./types.js";

const DEFAULT_CONFIG: ExecConfig = {
  maxConcurrency: 3,
};

export async function loadExecConfig(projectRoot?: string): Promise<ExecConfig> {
  const root = projectRoot || process.cwd();
  const configPath = resolve(root, ".devcompanion", "exec.json");

  try {
    const content = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(content) as Partial<ExecConfig>;

    const maxConcurrency = parsed.maxConcurrency;
    if (
      typeof maxConcurrency === "number" &&
      Number.isInteger(maxConcurrency) &&
      maxConcurrency > 0
    ) {
      return { maxConcurrency };
    }

    return DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}
