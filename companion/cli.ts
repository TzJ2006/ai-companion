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
  // Same handler the engine's own entry carries: a failure the engine planned
  // for — no graph yet, a graph that will not parse — has ONE sentence to say,
  // and it is the sentence that names the next command. Letting it out uncaught
  // prints a node stack trace instead, at a human who is being told the project
  // has no graph; and a hook must fail in the direction D9 decided, not by
  // spraying frames (D9/D34).
  try {
    const code = main(args);
    if (code !== -1) process.exit(code); // -1 = `serve` keeps the process alive
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(1);
  }
}
