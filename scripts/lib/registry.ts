import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

export interface RegistryEntry {
  path: string;
  installed_at: string;
  updated_at: string;
  enforce: boolean;
  commands: boolean;
}

export interface Registry {
  aidev_root: string;
  version: string;
  targets: RegistryEntry[];
}

const REGISTRY_DIR = join(homedir(), ".aidev-companion");
const REGISTRY_FILE = join(REGISTRY_DIR, "registry.json");

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

export function addTarget(registry: Registry, targetPath: string, enforce: boolean, commands: boolean): Registry {
  const resolved = resolve(targetPath);
  const existing = registry.targets.findIndex((t) => resolve(t.path) === resolved);

  const entry: RegistryEntry = {
    path: resolved,
    installed_at: existing >= 0 ? registry.targets[existing].installed_at : new Date().toISOString(),
    updated_at: new Date().toISOString(),
    enforce,
    commands,
  };

  if (existing >= 0) {
    registry.targets[existing] = entry;
  } else {
    registry.targets.push(entry);
  }

  return registry;
}

export function removeTarget(registry: Registry, targetPath: string): Registry {
  const resolved = resolve(targetPath);
  registry.targets = registry.targets.filter((t) => resolve(t.path) !== resolved);
  return registry;
}

export function getRegistryPath(): string {
  return REGISTRY_FILE;
}
