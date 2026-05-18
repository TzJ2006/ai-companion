import { readdir, rename, mkdir, stat } from "node:fs/promises";
import { resolve, basename, extname, dirname } from "node:path";

const MAX_ARCHIVE_VERSIONS = 10;

export interface ArchiveResult {
  archived: boolean;
  archive_path: string | null;
  exceeded_limit: boolean;
  excess_files: string[];
}

export async function archiveFile(filePath: string, archiveDir: string): Promise<ArchiveResult> {
  const fileExists = await stat(filePath).then(() => true).catch(() => false);
  if (!fileExists) {
    return { archived: false, archive_path: null, exceeded_limit: false, excess_files: [] };
  }

  await mkdir(archiveDir, { recursive: true });

  const name = basename(filePath, extname(filePath));
  const extension = extname(filePath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveName = `${name}-${timestamp}${extension}`;
  const archivePath = resolve(archiveDir, archiveName);

  await rename(filePath, archivePath);

  const existingFiles = await listArchiveFiles(archiveDir, name, extension);
  const exceeded = existingFiles.length > MAX_ARCHIVE_VERSIONS;
  const excessFiles = exceeded
    ? existingFiles.slice(0, existingFiles.length - MAX_ARCHIVE_VERSIONS)
    : [];

  return {
    archived: true,
    archive_path: archivePath,
    exceeded_limit: exceeded,
    excess_files: excessFiles,
  };
}

async function listArchiveFiles(archiveDir: string, baseName: string, extension: string): Promise<string[]> {
  const entries = await readdir(archiveDir);
  const matching = entries
    .filter((entry) => entry.startsWith(baseName + "-") && entry.endsWith(extension))
    .sort();
  return matching.map((entry) => resolve(archiveDir, entry));
}

export async function archiveConfirmation(confirmationPath: string, archiveDir: string): Promise<void> {
  const fileExists = await stat(confirmationPath).then(() => true).catch(() => false);
  if (!fileExists) return;

  await mkdir(archiveDir, { recursive: true });

  const name = basename(confirmationPath, extname(confirmationPath));
  const extension = extname(confirmationPath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveName = `${name}-${timestamp}${extension}`;
  const archivePath = resolve(archiveDir, archiveName);

  const { copyFile } = await import("node:fs/promises");
  await copyFile(confirmationPath, archivePath);
}
