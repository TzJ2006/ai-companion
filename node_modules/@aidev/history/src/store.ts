import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import type {
  ChangeRecord,
  ReviewSession,
  FileHistory,
  ProjectIndex,
  FunctionIndexEntry,
} from "./types.js";

export class HistoryStore {
  private root: string;
  private reviewsDir: string;
  private historyDir: string;
  private indexPath: string;

  constructor(projectRoot: string) {
    this.root = join(projectRoot, ".devcompanion");
    this.reviewsDir = join(this.root, "reviews");
    this.historyDir = join(this.root, "history");
    this.indexPath = join(this.root, "index.json");
  }

  async init(): Promise<void> {
    await mkdir(this.reviewsDir, { recursive: true });
    await mkdir(this.historyDir, { recursive: true });

    if (!existsSync(this.indexPath)) {
      const index: ProjectIndex = {
        project_root: dirname(this.root),
        last_updated: new Date().toISOString(),
        total_sessions: 0,
        total_changes: 0,
        function_index: {},
      };
      await this.writeJson(this.indexPath, index);
    }

    await this.ensureGitignore();
  }

  async saveSession(session: ReviewSession): Promise<string> {
    const filename = `${session.timestamp.replace(/[:.]/g, "-")}.json`;
    const filepath = join(this.reviewsDir, filename);
    await this.writeJson(filepath, session);

    for (const change of session.changes) {
      await this.appendToFileHistory(change);
    }

    await this.updateIndex(session);
    return filepath;
  }

  async getFileHistory(filePath: string): Promise<FileHistory | null> {
    const historyPath = this.fileHistoryPath(filePath);
    if (!existsSync(historyPath)) return null;
    return this.readJson<FileHistory>(historyPath);
  }

  async getFunctionHistory(functionHash: string): Promise<ChangeRecord[]> {
    const index = await this.readJson<ProjectIndex>(this.indexPath);
    const entry = index.function_index[functionHash];
    if (!entry) return [];

    const fileHistory = await this.getFileHistory(entry.file_path);
    if (!fileHistory) return [];

    return fileHistory.functions[functionHash]?.records ?? [];
  }

  async getIndex(): Promise<ProjectIndex> {
    return this.readJson<ProjectIndex>(this.indexPath);
  }

  async writeIndex(index: ProjectIndex): Promise<void> {
    await this.writeJson(this.indexPath, index);
  }

  async listSessions(limit = 20): Promise<string[]> {
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(this.reviewsDir);
    return files
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, limit);
  }

  async getSession(filename: string): Promise<ReviewSession> {
    return this.readJson<ReviewSession>(join(this.reviewsDir, filename));
  }

  private async appendToFileHistory(change: ChangeRecord): Promise<void> {
    const historyPath = this.fileHistoryPath(change.file_path);
    let history: FileHistory;

    if (existsSync(historyPath)) {
      history = await this.readJson<FileHistory>(historyPath);
    } else {
      await mkdir(dirname(historyPath), { recursive: true });
      history = {
        file_path: change.file_path,
        last_updated: change.timestamp,
        total_records: 0,
        functions: {},
      };
    }

    if (!history.functions[change.function_hash]) {
      history.functions[change.function_hash] = {
        function_hash: change.function_hash,
        function_name: change.function_name,
        class_name: change.class_name,
        records: [],
        prev_hashes: [],
      };
    }

    history.functions[change.function_hash].records.push(change);
    history.total_records++;
    history.last_updated = change.timestamp;

    await this.writeJson(historyPath, history);
  }

  private async updateIndex(session: ReviewSession): Promise<void> {
    const index = await this.readJson<ProjectIndex>(this.indexPath);
    index.total_sessions++;
    index.total_changes += session.total_changes;
    index.last_updated = session.timestamp;

    for (const change of session.changes) {
      const entry: FunctionIndexEntry = {
        hash: change.function_hash,
        file_path: change.file_path,
        function_name: change.function_name,
        class_name: change.class_name,
        last_modified: change.timestamp,
        change_count: (index.function_index[change.function_hash]?.change_count ?? 0) + 1,
        test_status: change.test_status,
      };
      index.function_index[change.function_hash] = entry;
    }

    await this.writeJson(this.indexPath, index);
  }

  private fileHistoryPath(filePath: string): string {
    const rel = relative(dirname(this.root), filePath);
    return join(this.historyDir, `${rel}.json`);
  }

  private async ensureGitignore(): Promise<void> {
    const gitignorePath = join(dirname(this.root), ".gitignore");
    const entry = ".devcompanion/";

    if (existsSync(gitignorePath)) {
      const content = await readFile(gitignorePath, "utf-8");
      if (!content.includes(entry)) {
        await writeFile(gitignorePath, content.trimEnd() + "\n" + entry + "\n");
      }
    } else {
      await writeFile(gitignorePath, entry + "\n");
    }
  }

  private async readJson<T>(path: string): Promise<T> {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content) as T;
  }

  private async writeJson(path: string, data: unknown): Promise<void> {
    await writeFile(path, JSON.stringify(data, null, 2) + "\n");
  }
}
