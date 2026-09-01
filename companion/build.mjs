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

const here = dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: [join(here, "cli.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: join(here, "dist", "companion.mjs"),
  // cli.ts's own shebang is preserved by esbuild as line 1; the banner lands
  // right after it, so it must NOT contain a second shebang.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "warning",
});
console.log("wrote companion/dist/companion.mjs");
