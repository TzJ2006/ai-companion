export interface FunctionParam {
    name: string;
    type: string | null;
    default_value: string | null;
    is_args: boolean;
    is_kwargs: boolean;
}
export interface FunctionSignature {
    name: string;
    params: FunctionParam[];
    return_type: string | null;
    decorators: string[];
    is_method: boolean;
    is_async: boolean;
    class_name: string | null;
    start_line: number;
    end_line: number;
    docstring: string | null;
}
export interface ParsedModule {
    file_path: string;
    functions: FunctionSignature[];
    classes: ClassInfo[];
    imports: ImportInfo[];
}
export interface ClassInfo {
    name: string;
    methods: FunctionSignature[];
    decorators: string[];
    start_line: number;
    end_line: number;
    bases: string[];
}
export interface ImportInfo {
    module: string;
    names: string[];
    is_from: boolean;
    line: number;
}
export interface FunctionIdentity {
    hash: string;
    file_path: string;
    function_name: string;
    class_name: string | null;
    param_signature: string;
}
//# sourceMappingURL=types.d.ts.map