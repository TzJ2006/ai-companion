export interface ModuleExport {
    name: string;
    kind: "function" | "type" | "interface" | "class" | "const";
    signature?: string;
}
export interface ModuleDependency {
    module: string;
    imports: string[];
}
export interface ModuleSlot {
    path: string;
    description: string;
    entryPoint: string;
    exports: ModuleExport[];
    dependencies: ModuleDependency[];
}
export interface DevCompanionConfig {
    projectRoot: string;
    modules: Record<string, ModuleSlot>;
    tests: {
        dir: string;
        naming: string;
        framework: "vitest";
        importPrefix: string;
    };
    reports: {
        dataFile: string;
        htmlFile: string;
        collectScript: string;
        renderScript: string;
    };
    tracking: {
        indexFile: string;
        historyDir: string;
        eclDir: string;
    };
    ignoredDirs: string[];
}
declare const config: DevCompanionConfig;
export default config;
//# sourceMappingURL=devcompanion.config.d.ts.map