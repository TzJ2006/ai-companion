import { Tree } from "web-tree-sitter";
import type { ParsedModule } from "./types.js";
export declare function initParser(): Promise<void>;
export declare function parseSource(source: string): Tree;
export declare function parseFile(filePath: string): Promise<ParsedModule>;
//# sourceMappingURL=parser.d.ts.map