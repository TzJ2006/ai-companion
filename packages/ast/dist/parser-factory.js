import { Parser, Language } from "web-tree-sitter";
import { readFile } from "node:fs/promises";
import { resolveWasmPath } from "./wasm-resolver.js";
export function createLanguageParser(config) {
    let parser = null;
    let language = null;
    async function init() {
        if (parser)
            return;
        await Parser.init();
        parser = new Parser();
        const wasmPath = resolveWasmPath(config.packageName, config.wasmFileName);
        language = await Language.load(wasmPath);
        parser.setLanguage(language);
    }
    function parseSource(source) {
        if (!parser)
            throw new Error("Parser not initialized. Call init() first.");
        const tree = parser.parse(source);
        if (!tree)
            throw new Error("Failed to parse source");
        return tree;
    }
    async function parseFile(filePath) {
        await init();
        const source = await readFile(filePath, "utf-8");
        const tree = parseSource(source);
        return config.parseModule(tree.rootNode, filePath);
    }
    return { init, parseSource, parseFile };
}
//# sourceMappingURL=parser-factory.js.map