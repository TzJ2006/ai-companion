export interface CallGraphEntry {
    function_name: string;
    class_name: string | null;
    file_path: string;
    start_line: number;
    end_line: number;
    calls: string[];
}
export interface CallGraph {
    entries: CallGraphEntry[];
    reverse_index: Record<string, string[]>;
}
export declare function analyzeFileCalls(filePath: string): Promise<CallGraphEntry[]>;
export declare function buildCallGraph(entries: CallGraphEntry[]): CallGraph;
export declare function formatFunctionId(filePath: string, className: string | null, functionName: string): string;
//# sourceMappingURL=call-graph.d.ts.map