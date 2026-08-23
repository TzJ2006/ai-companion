import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

export type RepoVisibility = "public" | "private";

export interface RegistryEntry {
  path: string;
  installed_at: string;
  updated_at: string;
  enforce: boolean;
  commands: boolean;
  agent?: "claude" | "codex" | "both";
  /** 3a: public-safe vs private gitignore. Missing on old entries → treat as public. */
  visibility?: RepoVisibility;
}

export interface Registry {
  aidev_root: string;
  version: string;
  targets: RegistryEntry[];
}

const REGISTRY_DIR = join(homedir(), ".aidev-companion");
const REGISTRY_FILE = join(REGISTRY_DIR, "registry.json");

/** Resolve + real filesystem casing (fixes Github vs GitHub on Windows). */
export function normalizeTargetPath(targetPath: string): string {
  const resolved = resolve(targetPath);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

/** Equality key: case-insensitive on win32 so registry lookups survive casing drift. */
export function pathKey(targetPath: string): string {
  const normalized = normalizeTargetPath(targetPath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function loadRegistry(): Registry {
  if (!existsSync(REGISTRY_FILE)) {
    return { aidev_root: "", version: "0.1.0", targets: [] };
  }
  try {
    return JSON.parse(readFileSync(REGISTRY_FILE, "utf-8"));
  } catch {
    return { aidev_root: "", version: "0.1.0", targets: [] };
  }
}

export function saveRegistry(registry: Registry): void {
  if (!existsSync(REGISTRY_DIR)) {
    mkdirSync(REGISTRY_DIR, { recursive: true });
  }
  writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2) + "\n");
}

export function addTarget(
  registry: Registry,
  targetPath: string,
  enforce: boolean,
  commands: boolean,
  agent: "claude" | "codex" | "both" = "both",
  visibility: RepoVisibility = "public"
): Registry {
  const resolved = normalizeTargetPath(targetPath);
  const key = pathKey(resolved);
  const matches = registry.targets.filter((t) => pathKey(t.path) === key);
  const installedAt =
    matches.length > 0
      ? matches.map((t) => t.installed_at).sort()[0]
      : new Date().toISOString();

  const entry: RegistryEntry = {
    path: resolved,
    installed_at: installedAt,
    updated_at: new Date().toISOString(),
    enforce,
    commands,
    agent,
    visibility,
  };

  // Optional leftover: collapse GitHub vs Github casing duplicates to one entry.
  registry.targets = registry.targets.filter((t) => pathKey(t.path) !== key);
  registry.targets.push(entry);
  return registry;
}

export function removeTarget(registry: Registry, targetPath: string): Registry {
  const key = pathKey(targetPath);
  registry.targets = registry.targets.filter((t) => pathKey(t.path) !== key);
  return registry;
}

export function getRegistryPath(): string {
  return REGISTRY_FILE;
}
