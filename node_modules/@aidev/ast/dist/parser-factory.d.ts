import { Tree, Node as SyntaxNode } from "web-tree-sitter";
import type { ParsedModule } from "./types.js";
export interface LanguageParserConfig {
    packageName: string;
    wasmFileName: string;
    parseModule: (rootNode: SyntaxNode, filePath: string) => ParsedModule;
}
export interface LanguageParserInstance {
    init(): Promise<void>;
    parseSource(source: string): Tree;
    parseFile(filePath: string): Promise<ParsedModule>;
}
export declare function createLanguageParser(config: LanguageParserConfig): LanguageParserInstance;
export type { SyntaxNode };
//# sourceMappingURL=parser-factory.d.ts.map