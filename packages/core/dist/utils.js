export function stripMarkdownFences(text) {
    const lines = text.trim().split("\n");
    if (lines[0]?.startsWith("```"))
        lines.shift();
    if (lines.at(-1)?.startsWith("```"))
        lines.pop();
    return lines.join("\n").trim();
}
//# sourceMappingURL=utils.js.map