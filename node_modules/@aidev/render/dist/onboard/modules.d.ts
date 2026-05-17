import type { FunctionSignature, ClassInfo, ParsedModule } from "@aidev/ast";
import type { FunctionReasonData, ReportData } from "./types.js";
export declare function renderModules(modules: ParsedModule[], reportData?: ReportData): string;
export declare function renderFunctionCard(fn: FunctionSignature, reasonData?: FunctionReasonData): string;
export declare function renderClassCard(cls: ClassInfo, filePath: string, reasonMap: Map<string, FunctionReasonData>): string;
//# sourceMappingURL=modules.d.ts.map