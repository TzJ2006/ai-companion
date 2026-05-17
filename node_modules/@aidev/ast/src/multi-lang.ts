import { extname } from "node:path";
import { initParser, parseFile } from "./parser.js";
import { initTsParser, parseTsFile } from "./ts-parser.js";
import type { ParsedModule } from "./types.js";

const PYTHON_EXTENSIONS = new Set([".py", ".pyi"]);
const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);

export function getSupportedExtensions(): string[] {
  return [...PYTHON_EXTENSIONS, ...TS_EXTENSIONS];
}

export async function initParsers(): Promise<void> {
  await Promise.all([initParser(), initTsParser()]);
}

export async function parseFileAuto(filePath: string): Promise<ParsedModule> {
  const ext = extname(filePath).toLowerCase();

  if (PYTHON_EXTENSIONS.has(ext)) {
    await initParser();
    return parseFile(filePath);
  }

  if (TS_EXTENSIONS.has(ext)) {
    await initTsParser();
    return parseTsFile(filePath);
  }

  throw new Error(`Unsupported file extension: ${ext}. Supported: ${getSupportedExtensions().join(", ")}`);
}
