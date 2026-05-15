import type { FunctionSignature, ParsedModule } from "@aidev/ast";
export interface TsTestGenConfig {
    test_framework: "vitest" | "jest";
    output_dir: string;
    include_source_body: boolean;
    llm_enhance: boolean;
}
export interface GeneratedTsTest {
    function_name: string;
    class_name: string | null;
    source_file: string;
    test_file_path: string;
    test_content: string;
    generated_at: string;
}
export declare function generateTestSkeleton(mod: ParsedModule, config: TsTestGenConfig): GeneratedTsTest[];
export declare function buildLlmEnhancePrompt(fn: FunctionSignature, sourceBody: string, skeleton: string): string;
//# sourceMappingURL=ts-generator.d.ts.map