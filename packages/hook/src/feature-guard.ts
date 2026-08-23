/**
 * Feature Guard matcher for PreToolUse (and PostToolUse verification reminders).
 *
 * Understands two ECL shapes:
 *   - /ccplan `feature_guard:` + `- id: GUARD-001` (feature: on a following line)
 *   - legacy v2.0 `- feature:` lists (onboard-packages.yaml)
 *
 * Path matching is suffix + segment-boundary safe: key `src/foo.ts` matches
 * `src/foo.ts` and `.../src/foo.ts`, but not `src/foo.tsxx` or `notsrc/foo.ts`.
 */

export interface GuardInfo {
  feature: string;
  description: string;
  invariants: string[];
  verifications: string[];
}

export interface ParsedGuard extends GuardInfo {
  status: string;
  keyFiles: string[];
}

const INACTIVE_GUARD_STATUSES = new Set(["completed", "retired"]);
const INACTIVE_ECL_STATUSES = new Set(["completed", "retired", "abandoned"]);

export function isInactiveEclStatus(status: string): boolean {
  const cleaned = status.replace(/\s+#.*$/, "").trim();
  return INACTIVE_ECL_STATUSES.has(cleaned);
}

export function isInactiveGuardStatus(status: string): boolean {
  return INACTIVE_GUARD_STATUSES.has(status.trim());
}

/** Repo-relative suffix match with path-segment boundaries. */
export function matchesGuardedPath(filePath: string, keyFile: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const normalizedKey = keyFile.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalizedKey) return false;
  if (normalizedPath === normalizedKey) return true;
  return normalizedPath.endsWith(`/${normalizedKey}`);
}

export function findMatchingGuards(content: string, filePath: string): GuardInfo[] {
  return parseFeatureGuards(content)
    .filter((guard) => !isInactiveGuardStatus(guard.status))
    .filter((guard) => guard.keyFiles.some((key) => matchesGuardedPath(filePath, key)))
    .map(({ feature, description, invariants, verifications }) => ({
      feature,
      description,
      invariants,
      verifications,
    }));
}

export function parseFeatureGuards(content: string): ParsedGuard[] {
  return [...parseGuardIdBlocks(content), ...parseLegacyFeatureBlocks(content)];
}

function parseGuardIdBlocks(content: string): ParsedGuard[] {
  const start = content.search(/^feature_guard:\s*(?:#.*)?$/m);
  if (start === -1) return [];
  const section = content.slice(start);
  const guardsHeader = section.search(/^\s*guards:\s*(?:#.*)?$/m);
  if (guardsHeader === -1) return [];
  const afterHeader = section.slice(guardsHeader);
  if (/^\s*guards:\s*\[\s*\]/m.test(afterHeader)) return [];

  const results: ParsedGuard[] = [];
  const blocks = afterHeader.split(/^\s*- id:\s*/m).slice(1);
  for (const block of blocks) {
    const keyFiles = extractListItems(block, "key_files");
    if (keyFiles.length === 0) continue;

    const id = stripQuotes(block.match(/^["']?(\S+?)["']?\s*$/m)?.[1] ?? "unknown");
    const feature = extractField(block, "feature") || id;
    const invariants = extractListItems(block, "invariants");
    const constraints = extractListItems(block, "constraints");

    results.push({
      feature,
      description: extractField(block, "description"),
      invariants: invariants.length > 0 ? invariants : constraints,
      verifications: extractVerificationCommands(block),
      status: extractField(block, "status") || "active",
      keyFiles,
    });
  }
  return results;
}

function parseLegacyFeatureBlocks(content: string): ParsedGuard[] {
  const results: ParsedGuard[] = [];
  const featureBlocks = content.split(/^\s*- feature:\s*/m);
  for (const block of featureBlocks.slice(1)) {
    const keyFiles = extractListItems(block, "key_files");
    if (keyFiles.length === 0) continue;

    const featureName = stripQuotes(block.match(/^["']?(.+?)["']?\s*$/m)?.[1] ?? "unknown");
    results.push({
      feature: featureName,
      description: extractField(block, "description"),
      invariants: extractListItems(block, "constraints"),
      verifications: extractVerificationCommands(block),
      status: extractField(block, "status") || "active",
      keyFiles,
    });
  }
  return results;
}

function extractField(block: string, field: string): string {
  const match = block.match(new RegExp(`^\\s*${field}:\\s*["']?(.+?)["']?\\s*$`, "m"));
  return match?.[1]?.trim() ?? "";
}

function extractListItems(block: string, field: string): string[] {
  const match = block.match(new RegExp(`${field}:\\s*\\r?\\n((?:\\s+-\\s*.+\\r?\\n?)+)`));
  if (!match) return [];
  const items: string[] = [];
  for (const line of match[1].matchAll(/-\s*["']?(.+?)["']?\s*$/gm)) {
    const value = line[1].trim();
    if (value) items.push(value);
  }
  return items;
}

function extractVerificationCommands(block: string): string[] {
  const commands: string[] = [];
  for (const match of block.matchAll(/command:\s*["']?(.+?)["']?\s*$/gm)) {
    const value = match[1].trim();
    if (value && !commands.includes(value)) commands.push(value);
  }
  return commands;
}

function stripQuotes(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}
