import { readFileSync, appendFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, extname } from "node:path";
const QUEUE_DIR = ".devcompanion/queue";
const SUPPORTED_EXTENSIONS = new Set([".py", ".pyi", ".ts", ".tsx", ".mts", ".cts"]);
export function handlePostToolUse(stdin, supportedExtensions = SUPPORTED_EXTENSIONS) {
    let input;
    try {
        input = JSON.parse(stdin);
    }
    catch {
        return;
    }
    const toolName = input.tool_name;
    if (toolName !== "Edit" && toolName !== "Write")
        return;
    const filePath = input.tool_input?.file_path;
    if (!filePath)
        return;
    const ext = extname(filePath).toLowerCase();
    if (!supportedExtensions.has(ext))
        return;
    const projectRoot = findProjectRoot(filePath);
    if (!projectRoot)
        return;
    const queueDir = join(projectRoot, QUEUE_DIR);
    if (!existsSync(queueDir)) {
        mkdirSync(queueDir, { recursive: true });
    }
    const event = {
        timestamp: new Date().toISOString(),
        tool: toolName,
        file_path: filePath,
        pre_snapshot_path: null,
        reason: "auto-captured from Claude Code session",
        ecl_context: detectActiveEcl(projectRoot),
    };
    const queueFile = join(queueDir, "events.jsonl");
    appendFileSync(queueFile, JSON.stringify(event) + "\n");
}
export function findProjectRoot(filePath) {
    let dir = resolve(filePath, "..");
    const root = resolve("/");
    while (dir !== root) {
        if (existsSync(join(dir, ".devcompanion")))
            return dir;
        if (existsSync(join(dir, ".git")))
            return dir;
        dir = resolve(dir, "..");
    }
    return null;
}
function detectActiveEcl(projectRoot) {
    const eclDir = join(projectRoot, "docs", "ecl");
    if (!existsSync(eclDir))
        return undefined;
    const files = readdirSync(eclDir).filter((f) => f.endsWith(".yaml"));
    for (const file of files) {
        try {
            const content = readFileSync(join(eclDir, file), "utf-8");
            const featureMatch = content.match(/^feature:\s*["']?(.+?)["']?$/m);
            const statusMatch = content.match(/^status:\s*["']?(.+?)["']?$/m);
            if (!featureMatch || !statusMatch)
                continue;
            const status = statusMatch[1];
            if (status === "completed" || status === "retired")
                continue;
            const feature = featureMatch[1];
            const reqIds = [...content.matchAll(/^\s*- id:\s*["']?(REQ-\d+)["']?$/gm)]
                .map((m) => m[1]);
            const decIds = [...content.matchAll(/^\s*- id:\s*["']?(DEC-\d+)["']?$/gm)]
                .map((m) => m[1]);
            return {
                feature,
                requirements: reqIds.length > 0 ? reqIds : undefined,
                decisions: decIds.length > 0 ? decIds : undefined,
                ecl_file: `docs/ecl/${file}`,
            };
        }
        catch {
            continue;
        }
    }
    return undefined;
}
if (process.stdin.isTTY === false) {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => {
        handlePostToolUse(data);
    });
}
//# sourceMappingURL=index.js.map