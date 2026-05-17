import { html as diff2htmlHtml } from "diff2html";
export function renderSessionToHtml(session, rawDiffs, options = { show_test_status: true, show_error_ids: true, style: "side-by-side" }) {
    const diffHtml = diff2htmlHtml(rawDiffs.join("\n"), {
        drawFileList: true,
        matching: "lines",
        outputFormat: options.style === "side-by-side" ? "side-by-side" : "line-by-line",
    });
    const summaryHtml = renderSummaryPanel(session);
    const annotationsHtml = renderAnnotationsPanel(session.changes, options);
    return buildFullPage(options.title ?? `Review: ${session.timestamp}`, summaryHtml, diffHtml, annotationsHtml);
}
function renderSummaryPanel(session) {
    const changesByFile = groupBy(session.changes, (c) => c.file_path);
    const fileList = Object.entries(changesByFile)
        .map(([file, changes]) => {
        const types = [...new Set(changes.map((c) => c.change_type))].join(", ");
        return `<li><code>${file}</code> — ${changes.length} change(s) [${types}]</li>`;
    })
        .join("\n");
    return `
    <div class="summary-panel">
      <h2>Summary</h2>
      <p><strong>${session.total_changes}</strong> changes across <strong>${session.files_changed.length}</strong> files</p>
      <p class="session-summary">${session.summary}</p>
      <h3>Files Changed</h3>
      <ul>${fileList}</ul>
    </div>
  `;
}
function renderAnnotationsPanel(changes, options) {
    const items = changes.map((c, i) => {
        const testBadge = options.show_test_status
            ? `<span class="badge badge-${c.test_status}">${c.test_status}</span>`
            : "";
        const errorBadge = options.show_error_ids && c.error_id
            ? `<span class="badge badge-error">Error #${c.error_id}</span>`
            : "";
        return `
      <div class="annotation-item" data-line="${c.start_line}" data-file="${c.file_path}">
        <div class="annotation-header">
          <span class="change-id">#${i + 1}</span>
          <code>${c.function_name}</code>
          <span class="change-type type-${c.change_type}">${c.change_type}</span>
          ${testBadge}
          ${errorBadge}
        </div>
        <div class="annotation-reason">
          <strong>Reason:</strong> ${escapeHtml(c.reason)}
          <span class="reason-source">(${c.reason_source})</span>
        </div>
        <div class="annotation-location">
          Lines ${c.start_line}–${c.end_line} in <code>${c.file_path}</code>
        </div>
      </div>
    `;
    });
    return `
    <div class="annotations-panel">
      <h2>Change Annotations</h2>
      ${items.join("\n")}
    </div>
  `;
}
function buildFullPage(title, summary, diffContent, annotations) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/diff2html/bundles/css/diff2html.min.css">
  <style>
    :root {
      --bg: #0d1117;
      --fg: #c9d1d9;
      --border: #30363d;
      --accent: #58a6ff;
      --green: #3fb950;
      --red: #f85149;
      --yellow: #d29922;
    }
    body { font-family: -apple-system, sans-serif; background: var(--bg); color: var(--fg); margin: 0; padding: 20px; }
    .layout { display: grid; grid-template-columns: 1fr 300px; gap: 20px; max-width: 1600px; margin: 0 auto; }
    .main-content { overflow-x: auto; }
    .sidebar { position: sticky; top: 20px; align-self: start; max-height: calc(100vh - 40px); overflow-y: auto; }
    .summary-panel, .annotations-panel { background: #161b22; border: 1px solid var(--border); border-radius: 6px; padding: 16px; margin-bottom: 16px; }
    .summary-panel h2, .annotations-panel h2 { margin-top: 0; color: var(--accent); }
    .annotation-item { border: 1px solid var(--border); border-radius: 4px; padding: 12px; margin-bottom: 8px; cursor: pointer; transition: border-color 0.2s; }
    .annotation-item:hover { border-color: var(--accent); }
    .annotation-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .change-id { font-weight: bold; color: var(--accent); }
    .change-type { font-size: 0.8em; padding: 2px 6px; border-radius: 3px; }
    .type-add { background: #1a3a2a; color: var(--green); }
    .type-modify { background: #2a2a1a; color: var(--yellow); }
    .type-delete { background: #3a1a1a; color: var(--red); }
    .badge { font-size: 0.75em; padding: 2px 6px; border-radius: 10px; margin-left: 4px; }
    .badge-pass { background: #1a3a2a; color: var(--green); }
    .badge-fail { background: #3a1a1a; color: var(--red); }
    .badge-pending { background: #2a2a1a; color: var(--yellow); }
    .badge-error { background: #3a1a1a; color: var(--red); }
    .annotation-reason { font-size: 0.9em; margin-bottom: 4px; }
    .reason-source { color: #8b949e; font-size: 0.8em; }
    .annotation-location { font-size: 0.8em; color: #8b949e; }
    code { background: #1a1a2e; padding: 2px 4px; border-radius: 3px; font-size: 0.9em; }
    .session-summary { font-style: italic; color: #8b949e; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="layout">
    <div class="main-content">
      ${summary}
      ${diffContent}
    </div>
    <div class="sidebar">
      ${annotations}
    </div>
  </div>
</body>
</html>`;
}
function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
function groupBy(arr, keyFn) {
    const result = {};
    for (const item of arr) {
        const key = keyFn(item);
        (result[key] ??= []).push(item);
    }
    return result;
}
//# sourceMappingURL=renderer.js.map