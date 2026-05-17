import type { FunctionIndexEntry } from "@aidev/history";
import { escapeHtml, slugify } from "./utils.js";

export function renderFunctionIndex(functionIndex: Record<string, FunctionIndexEntry>): string {
  const entries = Object.values(functionIndex).sort((a, b) => a.file_path.localeCompare(b.file_path));

  const byFile = new Map<string, FunctionIndexEntry[]>();
  for (const entry of entries) {
    const arr = byFile.get(entry.file_path) ?? [];
    arr.push(entry);
    byFile.set(entry.file_path, arr);
  }

  const rows = [...byFile.entries()].map(([file, fns]) => {
    const fnList = fns.map(f => {
      const cls = f.class_name ? `${f.class_name}.` : "";
      return `<li><code>${cls}${escapeHtml(f.function_name)}</code> <span class="hash">${f.hash.slice(0, 8)}</span></li>`;
    }).join("");
    return `
      <div class="index-file">
        <a href="#file-${slugify(file)}"><code>${escapeHtml(file)}</code></a>
        <ul>${fnList}</ul>
      </div>
    `;
  });

  return `
    <div class="index-panel">
      <h2>Function Index</h2>
      ${rows.join("\n")}
    </div>
  `;
}
