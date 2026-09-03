#!/usr/bin/env node
// I-096 — bundle engine + guard + the yaml dependency into ONE file that runs
// with plain node. The createRequire line in the banner is load-bearing:
// yaml's CJS build calls require('process'), and without the shim the bundle
// builds green and crashes at the first parse — reproduced locally during
// research, so do not remove it. Adjudication: D34 (esbuild direct; tsup is
// unmaintained, bun inlines build-machine paths, node SEA is a 100MB binary).
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const outfile = join(here, "dist", "companion.mjs");

// Build into memory, then swap the file in with ONE rename. esbuild's own write
// streams the bytes into place, and this artifact is not built only by a human
// at a quiet moment: `install.ts --update` rebuilds it before copying it into
// every registered repository, so a rebuild can land while something else is
// reading or executing that same path. A streamed write is observable
// half-finished — the reader gets a truncated bundle and node dies on a partial
// last line. A rename is atomic, so every reader sees either the whole old
// artifact or the whole new one, and two rebuilds racing just means the last
// rename wins (esbuild is deterministic, so they agree byte for byte).
const result = await build({
  entryPoints: [join(here, "cli.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile,
  write: false,
  // cli.ts's own shebang is preserved by esbuild as line 1; the banner lands
  // right after it, so it must NOT contain a second shebang.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "warning",
});

mkdirSync(dirname(outfile), { recursive: true });
const staged = `${outfile}.${process.pid}.tmp`;
writeFileSync(staged, result.outputFiles[0].contents);
try {
  // Windows refuses the replace while a reader still holds the old file open,
  // and that reader is gone in milliseconds — so retry briefly rather than fail
  // a build that has nothing wrong with it.
  for (let attempt = 0; ; attempt++) {
    try { renameSync(staged, outfile); break; }
    catch (err) {
      if (attempt >= 50 || !["EPERM", "EACCES", "EBUSY"].includes(err.code)) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
} catch (err) {
  rmSync(staged, { force: true });
  throw err;
}
console.log("wrote companion/dist/companion.mjs");
