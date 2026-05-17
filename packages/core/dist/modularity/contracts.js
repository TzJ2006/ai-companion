import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
export function buildContractFileContent(functions) {
    const lines = [
        "// Auto-generated interface contracts",
        "// Run: aidev analyze --modularity --emit-contracts",
        "",
    ];
    for (const fn of functions) {
        const fnName = fn.class_name ? `${fn.class_name}.${fn.function_name}` : fn.function_name;
        lines.push(`// ${fnName}: ${fn.contract.contract_summary}`);
        if (fn.contract.input_type) {
            lines.push(`export interface ${capitalize(fn.function_name)}Input ${fn.contract.input_type}`);
            lines.push("");
        }
        if (fn.contract.output_type && fn.contract.output_type !== "void") {
            lines.push(`export type ${capitalize(fn.function_name)}Output = ${fn.contract.output_type};`);
            lines.push("");
        }
        if (fn.contract.adapter_signature) {
            lines.push(`export type ${capitalize(fn.function_name)}Adapter = ${fn.contract.adapter_signature};`);
            lines.push("");
        }
    }
    return lines.join("\n");
}
function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
export async function emitContractFiles(functions, outputDir) {
    const byFile = new Map();
    for (const fn of functions) {
        const existing = byFile.get(fn.file_path) ?? [];
        existing.push(fn);
        byFile.set(fn.file_path, existing);
    }
    const writtenFiles = [];
    for (const [filePath, fns] of byFile) {
        const baseName = basename(filePath, ".ts");
        const contractFileName = `${baseName}.contracts.ts`;
        const outPath = join(outputDir, contractFileName);
        const content = buildContractFileContent(fns);
        await mkdir(dirname(outPath), { recursive: true });
        await writeFile(outPath, content);
        writtenFiles.push(outPath);
    }
    return writtenFiles;
}
//# sourceMappingURL=contracts.js.map