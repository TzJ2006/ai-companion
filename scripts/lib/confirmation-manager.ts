import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { archiveConfirmation } from "./archive.ts";

export interface ConfirmationEntry {
  id: string;
  confirmed: boolean;
  last_command?: string;
  last_result?: string;
  last_updated: string;
}

export interface ConfirmationState {
  version: string;
  exported_at: string;
  entries: Record<string, ConfirmationEntry>;
}

const CONFIRMATION_VERSION = "1.0";

export function createEmptyState(): ConfirmationState {
  return {
    version: CONFIRMATION_VERSION,
    exported_at: new Date().toISOString(),
    entries: {},
  };
}

export async function loadConfirmationState(filePath: string): Promise<ConfirmationState> {
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as ConfirmationState;
  } catch {
    return createEmptyState();
  }
}

export async function saveConfirmationState(
  state: ConfirmationState,
  filePath: string,
  archiveDirectory: string
): Promise<void> {
  await archiveConfirmation(filePath, archiveDirectory);

  state.exported_at = new Date().toISOString();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2));
}

export function shouldPreserveConfirmation(
  entry: ConfirmationEntry,
  currentCommand: string,
  currentResult: string
): boolean {
  if (!entry.confirmed) return false;
  if (entry.last_command !== currentCommand) return false;
  if (entry.last_result !== currentResult) return false;
  return true;
}

export function generateCheckboxId(
  type: "verification" | "function_test" | "delete_suggestion",
  featureName: string,
  itemName: string
): string {
  return `${type}::${featureName}::${itemName}`;
}
