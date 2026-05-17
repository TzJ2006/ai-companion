import { Tree, Node as SyntaxNode } from "web-tree-sitter";
import type { FunctionSignature, FunctionParam, ClassInfo, ImportInfo, ParsedModule } from "./types.js";
export declare function findWasmPath(): string;
export declare function initParser(): Promise<void>;
export declare function parseSource(source: string): Tree;
export declare function parseFile(filePath: string): Promise<ParsedModule>;
export declare function extractFunction(node: SyntaxNode, className: string | null): FunctionSignature;
export declare function extractParams(node: SyntaxNode): FunctionParam[];
export declare function extractClass(node: SyntaxNode): ClassInfo;
export declare function handleDecorated(node: SyntaxNode, functions: FunctionSignature[], classes: ClassInfo[], className: string | null): void;
export declare function extractDecorators(node: SyntaxNode): string[];
export declare function extractDocstring(bodyNode: SyntaxNode | null): string | null;
export declare function extractImport(node: SyntaxNode): ImportInfo;
export declare function extractFromImport(node: SyntaxNode): ImportInfo;
//# sourceMappingURL=parser.d.ts.map