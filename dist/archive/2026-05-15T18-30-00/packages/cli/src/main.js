#!/usr/bin/env node
import { Command } from "commander";
import { reviewCommand } from "./commands/review.js";
import { renderCommand } from "./commands/render.js";
import { historyCommand } from "./commands/history.js";
import { initCommand } from "./commands/init.js";
import { onboardCommand } from "./commands/onboard.js";
import { analyzeCommand } from "./commands/analyze.js";
const program = new Command();
program
    .name("aidev")
    .description("AI Dev Companion — structured code change tracking")
    .version("0.1.0");
program.addCommand(reviewCommand);
program.addCommand(renderCommand);
program.addCommand(historyCommand);
program.addCommand(initCommand);
program.addCommand(onboardCommand);
program.addCommand(analyzeCommand);
program.parse();
//# sourceMappingURL=main.js.map