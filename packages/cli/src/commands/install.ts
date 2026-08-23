import { Command } from "commander";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Compiles to packages/cli/dist/commands/install.js → companion root is four up.
const COMPANION_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  ".."
);

type AgentTarget = "claude" | "codex" | "both";

/**
 * Thin wrapper: all install logic + registry live in scripts/install.ts.
 * `aidev install` must not diverge from `npx tsx scripts/install.ts`.
 */
export const installCommand = new Command("install")
  .description(
    "Install AI Dev Companion into a target repo (delegates to scripts/install.ts)."
  )
  .option("-p, --project <path>", "Target project root path", ".")
  .option("--agent <agent>", "Install for claude, codex, or both", "both")
  .option("--enforce", "Also inject the PreToolUse enforcement hook", false)
  .option("--no-commands", "Skip installing .claude/commands/")
  .option("--public", "Treat the target as a public repo (strict gitignore)", false)
  .option("--private", "Treat the target as a private repo (looser gitignore)", false)
  .action(
    (opts: {
      project: string;
      agent: AgentTarget;
      enforce: boolean;
      commands?: boolean;
      public?: boolean;
      private?: boolean;
    }) => {
      if (opts.agent !== "claude" && opts.agent !== "codex" && opts.agent !== "both") {
        console.error("--agent must be one of: claude, codex, both");
        process.exitCode = 1;
        return;
      }
      if (opts.public && opts.private) {
        console.error("--public and --private are mutually exclusive");
        process.exitCode = 1;
        return;
      }

      const targetRoot = resolve(opts.project);
      if (targetRoot === COMPANION_ROOT) {
        console.error(
          "Refusing to install into the ai-companion source repo itself (it IS the companion)."
        );
        process.exitCode = 1;
        return;
      }
      if (!existsSync(targetRoot)) {
        console.error(`Target path does not exist: ${targetRoot}`);
        process.exitCode = 1;
        return;
      }

      const installScript = join(COMPANION_ROOT, "scripts", "install.ts");
      const args = ["tsx", installScript, targetRoot, "--agent", opts.agent];
      if (opts.enforce) args.push("--enforce");
      if (opts.commands === false) args.push("--no-commands");
      if (opts.public) args.push("--public");
      if (opts.private) args.push("--private");

      // Windows: npx is a .cmd shim — shell:true required for spawn.
      const result = spawnSync("npx", args, {
        cwd: COMPANION_ROOT,
        stdio: "inherit",
        shell: true,
        env: process.env,
      });

      if (result.error) {
        console.error(`Failed to run scripts/install.ts: ${result.error.message}`);
        process.exitCode = 1;
        return;
      }
      process.exitCode = result.status === null ? 1 : result.status;
    }
  );
