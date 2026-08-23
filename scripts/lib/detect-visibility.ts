/**
 * 3a — public vs private detection for the managed gitignore.
 * `--public` / `--private` flags win. Otherwise `gh api` when available.
 * Detection failure → public-safe (do not leak host layout into git).
 */
import { execFileSync } from "node:child_process";
import type { RepoVisibility } from "../../packages/history/src/managed-gitignore.ts";

export type { RepoVisibility };

export type CommandRunner = (
  command: string,
  args: string[],
  cwd: string
) => string | null;

export function parseGithubRemote(url: string): { owner: string; repo: string } | null {
  const cleaned = url.trim().replace(/\.git$/i, "");
  const match = cleaned.match(/github\.com[:/]([^/]+)\/([^/]+)$/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

export function detectRepoVisibility(
  targetPath: string,
  options: { flag?: RepoVisibility; runCommand?: CommandRunner } = {}
): RepoVisibility {
  if (options.flag === "public" || options.flag === "private") {
    return options.flag;
  }

  const run = options.runCommand ?? defaultRunCommand;
  const remote = run("git", ["remote", "get-url", "origin"], targetPath);
  if (!remote) return "public";

  const parsed = parseGithubRemote(remote);
  if (!parsed) return "public";

  const ghPrivate = run(
    "gh",
    ["api", `repos/${parsed.owner}/${parsed.repo}`, "--jq", ".private"],
    targetPath
  );
  if (ghPrivate && ghPrivate.trim().toLowerCase().replace(/"/g, "") === "true") {
    return "private";
  }
  return "public";
}

/**
 * Win32 `gh`/`git` are often `.cmd` shims — execFile(shell:false) → ENOENT.
 * Fall back to shell:true only in that case (same idea as runVerification;
 * this is a separate helper, not a collapse of that spawn policy).
 */
export function defaultRunCommand(command: string, args: string[], cwd: string): string | null {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      timeout: 8000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform === "win32" && code === "ENOENT") {
      try {
        return execFileSync(command, args, {
          cwd,
          encoding: "utf8",
          timeout: 8000,
          stdio: ["ignore", "pipe", "ignore"],
          shell: true,
        }).trim();
      } catch {
        return null;
      }
    }
    return null;
  }
}
