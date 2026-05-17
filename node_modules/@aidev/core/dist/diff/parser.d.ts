export interface DiffHunk {
    old_start: number;
    old_count: number;
    new_start: number;
    new_count: number;
    lines: DiffLine[];
}
export interface DiffLine {
    type: "add" | "delete" | "context";
    content: string;
    old_line: number | null;
    new_line: number | null;
}
export interface FileDiff {
    file_path: string;
    old_path: string | null;
    status: "added" | "modified" | "deleted" | "renamed";
    hunks: DiffHunk[];
    raw_diff: string;
}
export declare function getGitDiff(projectRoot: string, options?: {
    staged?: boolean;
    commit?: string;
}): Promise<FileDiff[]>;
export declare function parseUnifiedDiff(diffOutput: string): FileDiff[];
//# sourceMappingURL=parser.d.ts.map