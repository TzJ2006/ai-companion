#!/usr/bin/env node
// I-096 — the single entry the bundle exposes: every engine subcommand plus
// `guard --platform=<agent>` for the three hook wirings. One artifact, three
// agents; the target machine needs node and nothing else (D34).
import { main } from "./ideas.js";
import { runGuard } from "./guard.js";

const args = process.argv.slice(2);
if (args[0] === "guard") {
  runGuard(args.slice(1));
} else {
  const code = main(args);
  if (code !== -1) process.exit(code);   // -1 = `serve` keeps the process alive
}
