import { Node as SyntaxNode } from "web-tree-sitter";
import type { FunctionSignature, FunctionParam, ClassInfo, ImportInfo, ParsedModule } from "./types.js";
export declare const initTsParser: () => Promise<void>;
export declare const parseTsSource: (source: string) => import("web-tree-sitter").Tree;
export declare const parseTsFile: (filePath: string) => Promise<ParsedModule>;
export declare function extractTsFunction(node: SyntaxNode, className: string | null): FunctionSignature;
export declare function extractArrowFunctions(node: SyntaxNode, functions: FunctionSignature[]): void;
export declare function handleExportStatement(node: SyntaxNode, functions: FunctionSignature[], classes: ClassInfo[], imports: ImportInfo[]): void;
export declare function extractTsParams(node: SyntaxNode): FunctionParam[];
export declare function extractTsClass(node: SyntaxNode): ClassInfo;
export declare function extractTsMethod(node: SyntaxNode, className: string): FunctionSignature;
export declare function extractTsDecorators(node: SyntaxNode): string[];
export declare function extractJsDoc(node: SyntaxNode): string | null;
export declare function extractTsImport(node: SyntaxNode): ImportInfo;
export declare function cleanTypeAnnotation(text: string): string;
//# sourceMappingURL=ts-parser.d.ts.map