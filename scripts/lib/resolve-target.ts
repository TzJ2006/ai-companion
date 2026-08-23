import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/** Walk up from cwd until a `.git` file or directory is found. */
export function resolveGitRoot(cwd: string): string | null {
  let current = resolve(cwd);
  for (;;) {
    if (existsSync(join(current, ".git"))) {
      return current;
    }
    const parent = resolve(current, "..");
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/**
 * Project being overviewed or reported on.
 * `--target <path>` wins; otherwise the git root of `cwd`, else `cwd`.
 * Not the companion checkout — installed stubs keep an absolute script path
 * and inherit the host repo's working directory.
 */
export function resolveTargetProject(
  argv: string[] = process.argv,
  cwd: string = process.cwd(),
): string {
  const targetIndex = argv.indexOf("--target");
  if (targetIndex !== -1 && argv[targetIndex + 1]) {
    return resolve(cwd, argv[targetIndex + 1]);
  }
  return resolveGitRoot(cwd) ?? resolve(cwd);
}

export function resolveReportsDir(projectRoot: string): string {
  return join(projectRoot, ".devcompanion", "reports");
}
