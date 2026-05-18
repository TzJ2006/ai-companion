import type { ChangeRecord, ReviewSession, FileHistory, ProjectIndex } from "./types.js";
export declare class HistoryStore {
    private root;
    private reviewsDir;
    private historyDir;
    private indexPath;
    constructor(projectRoot: string);
    init(): Promise<void>;
    saveSession(session: ReviewSession): Promise<string>;
    getFileHistory(filePath: string): Promise<FileHistory | null>;
    getFunctionHistory(functionHash: string): Promise<ChangeRecord[]>;
    getIndex(): Promise<ProjectIndex>;
    writeIndex(index: ProjectIndex): Promise<void>;
    listSessions(limit?: number): Promise<string[]>;
    getSession(filename: string): Promise<ReviewSession>;
    private appendToFileHistoryBatch;
    private updateIndex;
    private fileHistoryPath;
    private ensureGitignore;
    private readJson;
    private writeJson;
}
//# sourceMappingURL=store.d.ts.map