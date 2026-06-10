import { readdirSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";

export interface ReportFile {
  name: string;
  relativePath: string;
  absolutePath: string;
  modifiedAt: string;
  sizeBytes: number;
}

export interface ProjectReport {
  name: string;
  path: string;
  reports: ReportFile[];
}

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  "__pycache__",
  "target",
  ".venv",
  "venv",
  "public",
]);

const MAX_DEPTH = 0;
const MAX_REPORTS_PER_PROJECT = 50;

function scanDirectory(
  dirPath: string,
  rootPath: string,
  depth: number,
  results: ReportFile[]
): void {
  if (depth > MAX_DEPTH || results.length >= MAX_REPORTS_PER_PROJECT) {
    return;
  }

  let entries;
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= MAX_REPORTS_PER_PROJECT) break;

    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
        scanDirectory(join(dirPath, entry.name), rootPath, depth + 1, results);
      }
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      const absolutePath = join(dirPath, entry.name);
      try {
        const stat = statSync(absolutePath);
        results.push({
          name: entry.name,
          relativePath: relative(rootPath, absolutePath).replace(/\\/g, "/"),
          absolutePath,
          modifiedAt: stat.mtime.toISOString(),
          sizeBytes: stat.size,
        });
      } catch {
        // skip files we cannot stat
      }
    }
  }
}

export function scanProject(name: string, projectPath: string): ProjectReport {
  const reports: ReportFile[] = [];
  scanDirectory(projectPath, projectPath, 0, reports);
  reports.sort(
    (a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
  );
  return { name, path: projectPath, reports };
}

export function scanAll(
  projects: Array<{ name: string; path: string }>
): ProjectReport[] {
  return projects.map((p) => scanProject(p.name, p.path));
}


export function scanSshReposDir(dirPath: string): ProjectReport[] {
  if (!dirPath) return [];
  let entries;
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: ProjectReport[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      const subPath = join(dirPath, entry.name);
      const report = scanProject(entry.name, subPath);
      results.push(report);
    }
  }
  return results;
}
