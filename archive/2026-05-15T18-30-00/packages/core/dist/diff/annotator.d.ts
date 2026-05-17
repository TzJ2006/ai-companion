import type { FileDiff, DiffHunk } from "./parser.js";
import type { FunctionSignature } from "@aidev/ast";
import type { ChangeRecord } from "@aidev/history";
export interface AnnotationContext {
    reason: string;
    reason_source: "context" | "llm-inferred" | "user-provided";
    session_id: string;
}
export interface AnnotatedChange {
    file_path: string;
    function_name: string;
    function_hash: string;
    class_name: string | null;
    change_type: ChangeRecord["change_type"];
    reason: string;
    reason_source: ChangeRecord["reason_source"];
    hunks: DiffHunk[];
    start_line: number;
    end_line: number;
}
export declare function annotateChanges(diffs: FileDiff[], functionMap: Map<string, FunctionSignature[]>, context: AnnotationContext): AnnotatedChange[];
export declare function toChangeRecords(annotations: AnnotatedChange[], sessionId: string): ChangeRecord[];
export declare function deduplicateByFunction(annotations: AnnotatedChange[]): AnnotatedChange[];
//# sourceMappingURL=annotator.d.ts.map