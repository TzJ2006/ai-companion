import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
export async function getGitDiff(projectRoot, options = {}) {
    const args = ["diff", "--unified=3"];
    if (options.commit) {
        args.push(options.commit);
    }
    else if (options.staged) {
        args.push("--cached");
    }
    const { stdout } = await execFileAsync("git", args, { cwd: projectRoot });
    return parseUnifiedDiff(stdout);
}
export function parseUnifiedDiff(diffOutput) {
    const files = [];
    const fileSections = diffOutput.split(/^diff --git /m).slice(1);
    for (const section of fileSections) {
        const lines = section.split("\n");
        const headerLine = lines[0];
        const pathMatch = headerLine.match(/a\/(.+?) b\/(.+)/);
        if (!pathMatch)
            continue;
        const oldPath = pathMatch[1];
        const newPath = pathMatch[2];
        let status = "modified";
        if (lines.some((l) => l.startsWith("new file")))
            status = "added";
        else if (lines.some((l) => l.startsWith("deleted file")))
            status = "deleted";
        else if (oldPath !== newPath)
            status = "renamed";
        const hunks = parseHunks(lines);
        files.push({
            file_path: newPath,
            old_path: status === "renamed" ? oldPath : null,
            status,
            hunks,
            raw_diff: "diff --git " + section,
        });
    }
    return files;
}
function parseHunks(lines) {
    const hunks = [];
    let currentHunk = null;
    let oldLine = 0;
    let newLine = 0;
    for (const line of lines) {
        const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (hunkMatch) {
            currentHunk = {
                old_start: parseInt(hunkMatch[1]),
                old_count: parseInt(hunkMatch[2] ?? "1"),
                new_start: parseInt(hunkMatch[3]),
                new_count: parseInt(hunkMatch[4] ?? "1"),
                lines: [],
            };
            hunks.push(currentHunk);
            oldLine = currentHunk.old_start;
            newLine = currentHunk.new_start;
            continue;
        }
        if (!currentHunk)
            continue;
        if (line.startsWith("+")) {
            currentHunk.lines.push({
                type: "add",
                content: line.slice(1),
                old_line: null,
                new_line: newLine++,
            });
        }
        else if (line.startsWith("-")) {
            currentHunk.lines.push({
                type: "delete",
                content: line.slice(1),
                old_line: oldLine++,
                new_line: null,
            });
        }
        else if (line.startsWith(" ")) {
            currentHunk.lines.push({
                type: "context",
                content: line.slice(1),
                old_line: oldLine++,
                new_line: newLine++,
            });
        }
    }
    return hunks;
}
//# sourceMappingURL=parser.js.map