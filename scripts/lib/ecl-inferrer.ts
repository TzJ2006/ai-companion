import { readdirSync, existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import type { ProjectLanguage } from "./project-detector.ts";

export interface InferredFeature {
  name: string;
  directory: string;
  description: string;
}

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  "__pycache__",
  ".git",
  ".devcompanion",
  "dist",
  "build",
  "out",
  ".next",
  ".venv",
  "venv",
  "env",
  ".env",
  "coverage",
  ".cache",
  "archive",
  "docs",
  "tests",
  "test",
  ".devcompanion",
]);

export function inferFeaturesFromStructure(
  projectPath: string,
  language: ProjectLanguage
): InferredFeature[] {
  const features: InferredFeature[] = [];
  const topLevelDirs = getCodeDirectories(projectPath);

  for (const directory of topLevelDirs) {
    const dirName = basename(directory);
    const description = inferDirectoryPurpose(dirName, directory, language);
    features.push({
      name: dirName,
      directory,
      description,
    });
  }

  return features;
}

function getCodeDirectories(projectPath: string): string[] {
  const entries = readdirSync(projectPath, { withFileTypes: true });
  const codeDirs: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    if (IGNORED_DIRECTORIES.has(entry.name)) continue;

    const fullPath = join(projectPath, entry.name);
    if (hasCodeFiles(fullPath)) {
      codeDirs.push(fullPath);
    }
  }

  return codeDirs;
}

function hasCodeFiles(directory: string): boolean {
  try {
    const entries = readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = entry.name.split(".").pop()?.toLowerCase();
        if (ext && ["ts", "tsx", "js", "jsx", "py", "go", "rs", "c", "cpp", "java", "kt"].includes(ext)) {
          return true;
        }
      }
      if (entry.isDirectory() && !entry.name.startsWith(".") && !IGNORED_DIRECTORIES.has(entry.name)) {
        if (hasCodeFiles(join(directory, entry.name))) return true;
      }
    }
  } catch { /* ignore */ }
  return false;
}

function inferDirectoryPurpose(dirName: string, dirPath: string, language: ProjectLanguage): string {
  const lowerName = dirName.toLowerCase();

  const purposeMap: Record<string, string> = {
    src: "主要源代码目录",
    lib: "核心库代码",
    utils: "工具函数集合",
    helpers: "辅助函数集合",
    api: "应用程序编程接口端点",
    routes: "路由定义",
    components: "用户界面组件",
    pages: "页面级组件",
    hooks: "自定义 hooks",
    services: "服务层逻辑",
    models: "数据模型定义",
    types: "类型定义",
    config: "配置管理",
    scripts: "脚本工具",
    cli: "命令行界面",
    core: "核心业务逻辑",
    common: "公共模块",
    shared: "共享代码",
    packages: "多包工作区",
    modules: "功能模块",
    middleware: "中间件",
    controllers: "控制器",
    views: "视图层",
    templates: "模板文件",
    static: "静态资源",
    assets: "资源文件",
    data: "数据处理",
    db: "数据库相关",
    database: "数据库相关",
    migrations: "数据库迁移",
    workers: "后台任务处理",
    jobs: "定时任务",
    plugins: "插件系统",
    extensions: "扩展模块",
    adapters: "适配器层",
    integrations: "第三方集成",
    auth: "认证与授权",
    security: "安全相关",
    logging: "日志系统",
    monitoring: "监控相关",
    benchmark: "性能基准测试",
    examples: "示例代码",
    research: "研究与实验代码",
  };

  if (purposeMap[lowerName]) {
    return purposeMap[lowerName];
  }

  return `${dirName} 模块`;
}

export function generateEclYaml(
  projectName: string,
  projectDescription: string | null,
  features: InferredFeature[]
): string {
  let yaml = `# Auto-generated Evolving Constraint Language document for ${projectName}\n`;
  yaml += `# Generated: ${new Date().toISOString()}\n`;
  yaml += `# This file was inferred from project directory structure.\n`;
  yaml += `# Please review and refine descriptions and verification commands.\n\n`;

  if (projectDescription) {
    yaml += `# Project: ${projectDescription}\n\n`;
  }

  yaml += `features:\n`;

  for (const feature of features) {
    yaml += `\n- feature: "${feature.name}"\n`;
    yaml += `  description: "${feature.description}"\n`;
    yaml += `  purpose: "提供 ${feature.description} 功能"\n`;
    yaml += `  implementation:\n`;
    yaml += `    approach: "基于目录结构推断"\n`;
    yaml += `    key_files:\n`;
    yaml += `      - "${feature.directory.replace(/\\/g, "/")}"\n`;
    yaml += `    constraints:\n`;
    yaml += `      - "自动推断，需人工验证"\n`;
    yaml += `  verification:\n`;
    yaml += `    - name: "${feature.name} 目录存在性检查"\n`;
    yaml += `      command: "test -d ${feature.directory.replace(/\\/g, "/")}"\n`;
    yaml += `      expect: "目录存在"\n`;
  }

  return yaml;
}

export function writeInferredEcl(
  projectPath: string,
  projectName: string,
  projectDescription: string | null,
  features: InferredFeature[]
): string {
  const eclDirectory = join(projectPath, "docs", "ecl");
  mkdirSync(eclDirectory, { recursive: true });

  const eclFilePath = join(eclDirectory, `${projectName}-features.yaml`);

  if (existsSync(eclFilePath)) {
    return eclFilePath;
  }

  const yamlContent = generateEclYaml(projectName, projectDescription, features);
  writeFileSync(eclFilePath, yamlContent, "utf-8");
  return eclFilePath;
}
