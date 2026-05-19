import { readdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type ProjectLanguage = "typescript" | "python" | "mixed" | "unknown";

export interface ProjectDetection {
  path: string;
  name: string;
  language: ProjectLanguage;
  has_code: boolean;
  skip_reason: string | null;
  has_devcompanion: boolean;
  has_ecl: boolean;
  description: string | null;
}

const SKIP_INDICATORS = new Set([
  "nul",
  "nul.txt",
]);

export function detectProject(projectPath: string): ProjectDetection {
  const name = projectPath.split(/[\\/]/).filter(Boolean).pop() ?? "unknown";
  const result: ProjectDetection = {
    path: projectPath,
    name,
    language: "unknown",
    has_code: false,
    skip_reason: null,
    has_devcompanion: existsSync(join(projectPath, ".devcompanion")),
    has_ecl: existsSync(join(projectPath, "docs", "ecl")),
    description: null,
  };

  if (!existsSync(projectPath)) {
    result.skip_reason = "路径不存在";
    return result;
  }

  const entries = readdirSync(projectPath);

  if (entries.length === 0) {
    result.skip_reason = "空目录";
    return result;
  }

  if (entries.every((entry) => SKIP_INDICATORS.has(entry))) {
    result.skip_reason = "无有效文件";
    return result;
  }

  const hasPackageJson = entries.includes("package.json");
  const hasPyprojectToml = entries.includes("pyproject.toml");
  const hasSetupPy = entries.includes("setup.py");
  const hasRequirementsTxt = entries.includes("requirements.txt");

  const hasTexFiles = entries.some((entry) => entry.endsWith(".tex"));
  const hasTsFiles = hasAnyFileRecursive(projectPath, [".ts", ".tsx"], 4);
  const hasPyFiles = hasAnyFileRecursive(projectPath, [".py"], 4);

  if (hasPackageJson || hasTsFiles) {
    result.language = hasPyFiles ? "mixed" : "typescript";
    result.has_code = true;
  } else if (hasPyprojectToml || hasSetupPy || hasRequirementsTxt || hasPyFiles) {
    result.language = "python";
    result.has_code = true;
  } else if (hasTexFiles && !hasTsFiles && !hasPyFiles) {
    result.skip_reason = "纯 LaTeX 项目，无源代码";
    return result;
  } else {
    const hasAnyCode = hasAnyFileRecursive(projectPath, [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".c", ".cpp", ".java"], 4);
    if (!hasAnyCode) {
      result.skip_reason = "未检测到源代码文件";
      return result;
    }
    result.language = "unknown";
    result.has_code = true;
  }

  result.description = extractDescription(projectPath, entries);
  return result;
}

function hasAnyFileRecursive(directory: string, extensions: string[], maxDepth: number): boolean {
  if (maxDepth <= 0) return false;

  try {
    const entries = readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "__pycache__" || entry.name === "dist" || entry.name === "build") {
        continue;
      }
      if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
        return true;
      }
      if (entry.isDirectory()) {
        if (hasAnyFileRecursive(join(directory, entry.name), extensions, maxDepth - 1)) {
          return true;
        }
      }
    }
  } catch {
    // permission denied or other error
  }
  return false;
}

function extractDescription(projectPath: string, entries: string[]): string | null {
  if (entries.includes("package.json")) {
    try {
      const packageJson = JSON.parse(readFileSync(join(projectPath, "package.json"), "utf-8"));
      if (packageJson.description) return packageJson.description;
    } catch { /* ignore */ }
  }

  if (entries.includes("pyproject.toml")) {
    try {
      const content = readFileSync(join(projectPath, "pyproject.toml"), "utf-8");
      const descMatch = content.match(/description\s*=\s*"([^"]+)"/);
      if (descMatch) return descMatch[1];
    } catch { /* ignore */ }
  }

  if (entries.includes("README.md")) {
    try {
      const readme = readFileSync(join(projectPath, "README.md"), "utf-8");
      const lines = readme.split("\n").filter((line) => line.trim() && !line.startsWith("#"));
      if (lines.length > 0) return lines[0].trim().slice(0, 200);
    } catch { /* ignore */ }
  }

  return null;
}

export function listProjectDirectories(parentDirectory: string): string[] {
  const entries = readdirSync(parentDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => join(parentDirectory, entry.name));
}
