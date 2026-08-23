/**
 * 3a — one gitignore policy for the installer and HistoryStore / `aidev init`.
 *
 * Public-safe (default if visibility detection fails): ignore `.devcompanion/*`
 * but keep tests; also hide machine-local Claude/Codex hook config.
 * Private is looser: runtime queue/reports stay out of git; analysis/logs may
 * be committed. HistoryStore never writes blanket `.devcompanion/` (that hid tests).
 */

export type RepoVisibility = "public" | "private";

/** Distinct from visibility: `init` is the tests-preserving core only (no agent-config ignores). */
export type GitignoreProfile = "init" | "public" | "private";

export const GITIGNORE_MANAGED_START = "# >>> AI Dev Companion (managed)";
export const GITIGNORE_MANAGED_END = "# <<< AI Dev Companion";

const LEGACY_DEVCOMPANION_LINES = new Set([
  ".devcompanion/",
  ".devcompanion/*",
  "!.devcompanion/tests/",
]);

export function hasManagedGitignoreBlock(content: string): boolean {
  return (
    content.includes(GITIGNORE_MANAGED_START) &&
    content.includes(GITIGNORE_MANAGED_END)
  );
}

export function managedGitignoreBlock(profile: GitignoreProfile): string {
  const lines: string[] = [GITIGNORE_MANAGED_START];
  if (profile === "private") {
    // 3a private: do not hide tests; analysis.json / logs may be committed
    lines.push(
      "# 3a private: runtime only — tests and analysis/logs may be committed",
      ".devcompanion/queue/",
      ".devcompanion/reports/",
    );
  } else if (profile === "public") {
    // Command stubs / CLAUDE.md are rewritten without machine-local paths (3b),
    // so they stay commitable. Residual abs paths belong in settings/hooks.json,
    // which this block already ignores.
    lines.push(
      "# 3a public-safe: hide runtime state, keep tests; hide machine-local agent config",
      ".devcompanion/*",
      "!.devcompanion/tests/",
      ".claude/settings.json",
      ".codex/hooks.json",
    );
  } else {
    lines.push(
      "# 3a tests-preserving (aidev init / HistoryStore; installer may replace this block)",
      ".devcompanion/*",
      "!.devcompanion/tests/",
    );
  }
  lines.push(GITIGNORE_MANAGED_END);
  return lines.join("\n");
}

/**
 * Insert or replace the managed block. Idempotent. Strips leftover blanket
 * `.devcompanion/` lines (inside or outside the block) that would hide tests.
 */
export function applyManagedGitignore(existing: string, profile: GitignoreProfile): string {
  const block = managedGitignoreBlock(profile);
  const normalized = existing.replace(/\r\n/g, "\n");
  const start = normalized.indexOf(GITIGNORE_MANAGED_START);
  const end = normalized.indexOf(GITIGNORE_MANAGED_END);

  let before: string;
  let after: string;
  if (start >= 0 && end >= start) {
    before = normalized.slice(0, start);
    after = normalized.slice(end + GITIGNORE_MANAGED_END.length);
  } else {
    before = normalized;
    after = "";
  }

  return joinParts(stripLegacyDevcompanionLines(before), block, stripLegacyDevcompanionLines(after));
}

function stripLegacyDevcompanionLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !LEGACY_DEVCOMPANION_LINES.has(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

function joinParts(before: string, block: string, after: string): string {
  const pieces = [before, block, after].filter((part) => part.length > 0);
  return `${pieces.join("\n\n")}\n`;
}

export function visibilityToGitignoreProfile(visibility: RepoVisibility): GitignoreProfile {
  return visibility === "private" ? "private" : "public";
}
