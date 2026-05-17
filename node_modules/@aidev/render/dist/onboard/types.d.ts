import type { ParsedModule } from "@aidev/ast";
export interface FunctionReasonData {
    file_path: string;
    function_name: string;
    class_name: string | null;
    signature: string;
    reason: string;
    reason_source: "llm-inferred" | "user-provided" | "heuristic";
    test_file: string | null;
    test_status: "passed" | "failed" | "no-test";
    test_details: Array<{
        name: string;
        status: string;
        reason?: string;
    }>;
}
export interface ReportData {
    generated_at: string;
    total_functions: number;
    total_tests: number;
    tests_passed: number;
    tests_failed: number;
    functions: FunctionReasonData[];
}
export interface OnboardRenderOptions {
    title?: string;
    project_root: string;
    modules: ParsedModule[];
    reportData?: ReportData;
}
//# sourceMappingURL=types.d.ts.map