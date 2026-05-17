import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
export class ModularityStore {
    filePath;
    root;
    constructor(projectRoot) {
        this.root = projectRoot;
        this.filePath = join(projectRoot, ".devcompanion", "modularity.json");
    }
    async read() {
        if (!existsSync(this.filePath))
            return null;
        const raw = await readFile(this.filePath, "utf-8");
        return JSON.parse(raw);
    }
    async write(data) {
        await mkdir(join(this.root, ".devcompanion"), { recursive: true });
        await writeFile(this.filePath, JSON.stringify(data, null, 2));
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
    async upsertBatch(analyses, modules) {
        const data = await this.read() ?? this.emptyStore();
        for (const a of analyses) {
            data.functions[a.function_hash] = a;
        }
        data.modules = modules;
        data.total_analyzed = Object.keys(data.functions).length;
        data.analyzed_at = new Date().toISOString();
        await this.write(data);
    }
    async writeModules(modules) {
        const data = await this.read() ?? this.emptyStore();
        data.modules = modules;
        data.analyzed_at = new Date().toISOString();
        await this.write(data);
    }
    emptyStore() {
        return {
            project_root: this.root,
            analyzed_at: new Date().toISOString(),
            total_analyzed: 0,
            functions: {},
            modules: {},
        };
    }
}
//# sourceMappingURL=modularity-store.js.map