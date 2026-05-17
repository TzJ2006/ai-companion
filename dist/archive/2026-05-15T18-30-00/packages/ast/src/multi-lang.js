import { extname } from "node:path";
import { initParser, parseFile } from "./parser.js";
import { initTsParser, parseTsFile } from "./ts-parser.js";
const PYTHON_EXTENSIONS = new Set([".py", ".pyi"]);
const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
export function getSupportedExtensions() {
    return [...PYTHON_EXTENSIONS, ...TS_EXTENSIONS];
}
export async function initParsers() {
    await Promise.all([initParser(), initTsParser()]);
}
export async function parseFileAuto(filePath) {
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
//# sourceMappingURL=multi-lang.js.map