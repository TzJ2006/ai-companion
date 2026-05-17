import type { FunctionSignature } from "@aidev/ast";
import type { ChangeRecord } from "@aidev/history";
export interface TestGenerationConfig {
    llm_provider: "claude" | "openai" | "local";
    api_key?: string;
    model?: string;
    test_framework: "pytest";
    output_dir: string;
}
export interface GeneratedTest {
    function_name: string;
    function_hash: string;
    test_file_path: string;
    test_content: string;
    test_type: "normal" | "edge_case";
    generated_at: string;
}
export declare function buildTestPrompt(fn: FunctionSignature, change: ChangeRecord | null, testType: "normal" | "edge_case"): string;
export declare function buildTestFilePath(config: TestGenerationConfig, fn: FunctionSignature, sourceFilePath: string): string;
export declare function parseTestResponse(llmResponse: string): string;
//# sourceMappingURL=generator.d.ts.map