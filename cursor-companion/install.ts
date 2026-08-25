#!/usr/bin/env npx tsx
// Install Cursor Companion into a target project.
//
//   npx tsx install.ts <target>           # copy into <target>/.cursor/  (default)
//   npx tsx install.ts <target> --link    # target points at this folder
//   npx tsx install.ts <target> --global  # also copy skills to ~/.cursor/skills/
//   npx tsx install.ts --plugin           # copy this folder to ~/.cursor/plugins/local/

import {
  cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { AGENT, ledgerNames } from "./gate-lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const isWin = process.platform === "win32";
const npmBin = isWin ? "npm.cmd" : "npm";
const npxBin = isWin ? "npx.cmd" : "npx";
const SKILLS = ["idea-onboard", "idea-discuss", "idea-build", "idea-debug", "idea-record"];

function usage(): void {
  console.log(`Usage: npx tsx install.ts <target-path> [options]

Install Cursor Companion into a target project.

Options:
  --link      Point the target at this companion folder (junction/symlink skills + engine shim)
  --global    Also copy skills into ~/.cursor/skills/ (available in every project)
  --plugin    Copy this folder to ~/.cursor/plugins/local/cursor-companion
  --help, -h  Show this help

Default is --copy: a self-contained install under <target>/.cursor/.
`);
}

function copyDir(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true, force: true });
}

function linkDir(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  symlinkSync(src, dest, process.platform === "win32" ? "junction" : "dir");
}

function write(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function mergeHooks(targetHooks: string): void {
  const ours: Record<string, { command: string; matcher?: string; failClosed?: boolean }[]> = {
    afterFileEdit: [{ command: "node .cursor/hooks/record.mjs" }],
    sessionStart: [{ command: "node .cursor/hooks/session.mjs" }],
    preToolUse: [{
      command: "node .cursor/hooks/gate.mjs",
      matcher: "Write|StrReplace|Delete|EditNotebook|ApplyPatch",
      failClosed: true,
    }],
  };
  let existing: { version?: number; hooks?: Record<string, { command?: string; matcher?: string; failClosed?: boolean }[]> } = {
    version: 1, hooks: {},
  };
  if (existsSync(targetHooks)) {
    try { existing = JSON.parse(readFileSync(targetHooks, "utf8")); } catch { /* start fresh */ }
  }
  existing.version = existing.version ?? 1;
  existing.hooks = existing.hooks ?? {};
  for (const [event, list] of Object.entries(ours)) {
    const cur = existing.hooks[event] ?? [];
    for (const item of list) {
      if (!cur.some((x) => x.command === item.command)) cur.push(item);
    }
    existing.hooks[event] = cur;
  }
  write(targetHooks, JSON.stringify(existing, null, 2) + "\n");
}

function npmInstall(dir: string): void {
  let r = spawnSync(npmBin, ["install", "--omit=dev"], {
    cwd: dir, stdio: "inherit", shell: false,
  });
  // win32: npm.cmd often ENOENT with shell:false; cmd.exe can resolve it.
  if (isWin && (r.error || r.status !== 0)) {
    r = spawnSync("npm", ["install", "--omit=dev"], {
      cwd: dir, stdio: "inherit", shell: true,
    });
  }
  if (r.status !== 0) {
    console.warn(`warn: npm install in ${dir} failed — run it yourself so \`yaml\` resolves`);
  }
}

function installPlugin(): void {
  const dest = join(homedir(), ".cursor", "plugins", "local", "cursor-companion");
  copyDir(HERE, dest);
  console.log(`plugin copied to ${dest}`);
  console.log("Enable it in Cursor: Customize → Plugins → local");
}

function engineShim(sourceEngine: string): string {
  const escaped = JSON.stringify(sourceEngine.replace(/\\/g, "/"));
  return `#!/usr/bin/env npx tsx
import { spawnSync } from "node:child_process";
const engine = ${escaped};
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const r = spawnSync(npx, ["tsx", engine, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);
`;
}

function installTarget(target: string, mode: "copy" | "link"): void {
  const cursor = join(target, ".cursor");
  const companionDir = join(cursor, "companion");
  const skillsDir = join(cursor, "skills");
  const hooksDir = join(cursor, "hooks");
  mkdirSync(cursor, { recursive: true });

  write(join(cursor, "companion.json"), JSON.stringify({
    version: 1,
    mode,
    engine: ".cursor/companion/ideas.ts",
    source: relative(target, HERE).replace(/\\/g, "/"),
  }, null, 2) + "\n");

  if (mode === "copy") {
    mkdirSync(companionDir, { recursive: true });
    cpSync(join(HERE, "ideas.ts"), join(companionDir, "ideas.ts"));
    cpSync(join(HERE, "FORMAT.md"), join(companionDir, "FORMAT.md"));
    cpSync(join(HERE, "gate-lib.mjs"), join(companionDir, "gate-lib.mjs"));
    cpSync(join(HERE, "package.json"), join(companionDir, "package.json"));
    npmInstall(companionDir);
    for (const name of SKILLS) {
      copyDir(join(HERE, "skills", name), join(skillsDir, name));
    }
  } else {
    mkdirSync(companionDir, { recursive: true });
    write(join(companionDir, "ideas.ts"), engineShim(join(HERE, "ideas.ts")));
    write(join(companionDir, "FORMAT.md"), readFileSync(join(HERE, "FORMAT.md"), "utf8"));
    cpSync(join(HERE, "gate-lib.mjs"), join(companionDir, "gate-lib.mjs"));
    for (const name of SKILLS) {
      linkDir(join(HERE, "skills", name), join(skillsDir, name));
    }
  }

  copyDir(join(HERE, "rules"), join(cursor, "rules"));
  mkdirSync(hooksDir, { recursive: true });
  cpSync(join(HERE, "hooks", "record.mjs"), join(hooksDir, "record.mjs"));
  cpSync(join(HERE, "hooks", "session.mjs"), join(hooksDir, "session.mjs"));
  cpSync(join(HERE, "hooks", "gate.mjs"), join(hooksDir, "gate.mjs"));
  mergeHooks(join(cursor, "hooks.json"));

  const names = ledgerNames(target);
  const ideasDir = join(target, "ideas");
  const graphFile = join(ideasDir, names.graph);
  const logFile = join(ideasDir, names.log);
  if (!existsSync(graphFile)) {
    let r = spawnSync(npxBin, ["tsx", join(companionDir, "ideas.ts"), "init", "--project", target], {
      stdio: "inherit", shell: false, cwd: target,
    });
    if (isWin && (r.error || r.status !== 0)) {
      r = spawnSync("npx", ["tsx", join(companionDir, "ideas.ts"), "init", "--project", target], {
        stdio: "inherit", shell: true, cwd: target,
      });
    }
    if (r.status !== 0) {
      mkdirSync(ideasDir, { recursive: true });
      const name = target.split(/[\\/]/).pop() ?? "project";
      write(graphFile, `version: 1\nagent: ${AGENT}\nproject: ${name}\noverview: >\n  一段话说清这个项目在做什么。\nenforce: true\nexempt: []\nendpoints: []\nideas: []\n`);
      if (!existsSync(logFile)) {
        write(logFile, "# Change log\n\nAppend-only. Every code, doc, and idea change goes here.\n");
      }
    }
  }

  console.log(`installed (${mode}) into ${target}`);
  console.log(`  engine  ${relative(target, join(companionDir, "ideas.ts"))}`);
  console.log(`  skills  ${SKILLS.join(", ")}`);
  console.log(`  graph   ideas/${names.graph}`);
  console.log(`Next: /idea-onboard  — or open ideas/${names.html} after the first render.`);
}

function installGlobal(): void {
  const dest = join(homedir(), ".cursor", "skills");
  for (const name of SKILLS) copyDir(join(HERE, "skills", name), join(dest, name));
  console.log(`skills copied to ${dest}`);
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  usage();
  process.exit(args.length === 0 ? 1 : 0);
}

const wantLink = args.includes("--link");
const wantGlobal = args.includes("--global");
const wantPlugin = args.includes("--plugin");
const positional = args.filter((a) => !a.startsWith("--"));

if (wantPlugin) installPlugin();

if (positional.length === 0) {
  if (!wantPlugin && !wantGlobal) { usage(); process.exit(1); }
  if (wantGlobal) installGlobal();
  process.exit(0);
}

const target = resolve(positional[0]);
if (!existsSync(target)) {
  console.error(`Error: target does not exist: ${target}`);
  process.exit(1);
}

installTarget(target, wantLink ? "link" : "copy");
if (wantGlobal) installGlobal();
