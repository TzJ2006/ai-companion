import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
export class AnalysisStore {
    analysisPath;
    root;
    constructor(projectRoot) {
        this.root = projectRoot;
        this.analysisPath = join(projectRoot, ".devcompanion", "analysis.json");
    }
    async read() {
        if (!existsSync(this.analysisPath))
            return null;
        const raw = await readFile(this.analysisPath, "utf-8");
        return JSON.parse(raw);
    }
    async write(data) {
        await mkdir(join(this.root, ".devcompanion"), { recursive: true });
        await writeFile(this.analysisPath, JSON.stringify(data, null, 2));
    }
    async getFunction(hash) {
        const data = await this.read();
        return data?.functions[hash] ?? null;
    }
    async upsertFunction(analysis) {
        const data = await this.read() ?? this.emptyStore();
        data.functions[analysis.function_hash] = analysis;
        data.total_analyzed = Object.keys(data.functions).length;
        data.analyzed_at = new Date().toISOString();
        await this.write(data);
    }
    async upsertBatch(analyses) {
        const data = await this.read() ?? this.emptyStore();
        for (const analysis of analyses) {
            data.functions[analysis.function_hash] = analysis;
        }
        data.total_analyzed = Object.keys(data.functions).length;
        data.analyzed_at = new Date().toISOString();
        await this.write(data);
    }
    emptyStore() {
        return {
            project_root: this.root,
            analyzed_at: new Date().toISOString(),
            total_analyzed: 0,
            functions: {},
        };
    }
}
//# sourceMappingURL=analysis-store.js.map