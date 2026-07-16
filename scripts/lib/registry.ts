import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

export interface RegistryEntry {
  path: string;
  installed_at: string;
  updated_at: string;
  enforce: boolean;
  commands: boolean;
  agent?: "claude" | "codex" | "both";
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
  agent: "claude" | "codex" | "both" = "both"
): Registry {
  const resolved = normalizeTargetPath(targetPath);
  const key = pathKey(resolved);
  const existing = registry.targets.findIndex((t) => pathKey(t.path) === key);

  const entry: RegistryEntry = {
    path: resolved,
    installed_at: existing >= 0 ? registry.targets[existing].installed_at : new Date().toISOString(),
    updated_at: new Date().toISOString(),
    enforce,
    commands,
    agent,
  };

  if (existing >= 0) {
    registry.targets[existing] = entry;
  } else {
    registry.targets.push(entry);
  }

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
