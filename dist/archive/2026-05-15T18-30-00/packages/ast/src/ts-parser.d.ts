import { Tree } from "web-tree-sitter";
import type { ParsedModule } from "./types.js";
export declare function initTsParser(): Promise<void>;
export declare function parseTsSource(source: string): Tree;
export declare function parseTsFile(filePath: string): Promise<ParsedModule>;
//# sourceMappingURL=ts-parser.d.ts.map