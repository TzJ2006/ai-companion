import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface ProjectEntry {
  name: string;
  path: string;
}

export interface DashboardConfig {
  projects: ProjectEntry[];
  port: number;
  exportDir?: string;
  sshReposDir?: string;
}

const CONFIG_PATH = join(homedir(), ".aidev-dashboard.json");

const DEFAULT_CONFIG: DashboardConfig = {
  projects: [],
  port: 4200,
};

export function loadConfig(configPath: string = CONFIG_PATH): DashboardConfig {
  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG, projects: [] };
  }
  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<DashboardConfig>;
    return {
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      port: typeof parsed.port === "number" ? parsed.port : DEFAULT_CONFIG.port,
      sshReposDir: typeof parsed.sshReposDir === "string" ? parsed.sshReposDir : undefined,
      exportDir: typeof parsed.exportDir === "string" ? parsed.exportDir : undefined,
    };
  } catch {
    return { ...DEFAULT_CONFIG, projects: [] };
  }
}

export function saveConfig(config: DashboardConfig, configPath: string = CONFIG_PATH): void {
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

export function addProject(
  config: DashboardConfig,
  name: string,
  projectPath: string
): DashboardConfig {
  const existing = config.projects.find((p) => p.name === name);
  if (existing) {
    throw new Error(`Project "${name}" already exists`);
  }
  const updated: DashboardConfig = {
    ...config,
    projects: [...config.projects, { name, path: projectPath }],
  };
  saveConfig(updated);
  return updated;
}

export function removeProject(
  config: DashboardConfig,
  name: string
): DashboardConfig {
  const updated: DashboardConfig = {
    ...config,
    projects: config.projects.filter((p) => p.name !== name),
  };
  saveConfig(updated);
  return updated;
}
