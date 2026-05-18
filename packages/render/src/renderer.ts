import type { ReviewSession, ChangeRecord, EclContext } from "@aidev/history";

export interface RenderOptions {
  title?: string;
  show_test_status: boolean;
  show_error_ids: boolean;
  style: "side-by-side" | "line-by-line";
}

export function renderSessionToHtml(
  session: ReviewSession,
  _rawDiffs: string[],
  options: RenderOptions = { show_test_status: true, show_error_ids: true, style: "side-by-side" }
): string {
  const title = options.title ?? `Review: ${session.timestamp}`;
  const groups = groupByReason(session.changes);

  const groupsHtml = groups.map((group, gi) => renderReasonGroup(group, gi)).join("\n");

  return buildPage(title, session, groupsHtml);
}

interface ReasonGroup {
  reason: string;
  reason_source: string;
  ecl_context?: EclContext;
  files: Map<string, ChangeRecord[]>;
  total: number;
}

function groupByReason(changes: ChangeRecord[]): ReasonGroup[] {
  const map = new Map<string, ReasonGroup>();

  for (const c of changes) {
    const key = c.reason;
    let group = map.get(key);
    if (!group) {
      group = { reason: c.reason, reason_source: c.reason_source, ecl_context: c.ecl_context, files: new Map(), total: 0 };
      map.set(key, group);
    }
    const fileList = group.files.get(c.file_path) ?? [];
    fileList.push(c);
    group.files.set(c.file_path, fileList);
    group.total++;
  }

  return Array.from(map.values());
}

function renderReasonGroup(group: ReasonGroup, index: number): string {
  const filesHtml = Array.from(group.files.entries())
    .map(([filePath, changes]) => renderFileSection(filePath, changes))
    .join("\n");

  return `
    <div class="reason-group">
      <div class="reason-header" onclick="toggleGroup(this)">
        <span class="reason-arrow">&#9660;</span>
        <span class="reason-text">${escapeHtml(group.reason)}</span>
        <span class="reason-meta">${group.total} change${group.total > 1 ? "s" : ""} &middot; ${group.reason_source}${group.ecl_context ? ` &middot; <span class="ecl-tag">${escapeHtml(group.ecl_context.feature)}</span>` : ""}</span>
      </div>
      <div class="reason-body open">
        ${filesHtml}
      </div>
    </div>
  `;
}

function renderFileSection(filePath: string, changes: ChangeRecord[]): string {
  const items = changes.map((c) => renderFunctionItem(c)).join("\n");

  return `
    <div class="file-section">
      <div class="file-path">${escapeHtml(filePath)}</div>
      ${items}
    </div>
  `;
}

function renderFunctionItem(c: ChangeRecord): string {
  const diffHtml = renderInlineDiff(c.old_content, c.new_content);
  const id = `fn-${c.function_hash}-${c.start_line}`;

  return `
    <div class="fn-item">
      <div class="fn-header" onclick="toggleFn('${id}')">
        <span class="fn-arrow" id="arrow-${id}">&#9654;</span>
        <span class="fn-name">${escapeHtml(c.function_name)}</span>
        <span class="fn-badge fn-badge-${c.change_type}">${c.change_type}</span>
        <span class="fn-lines">L${c.start_line}–${c.end_line}</span>
${c.ecl_context ? `        <span class="ecl-badge" title="${escapeHtml(c.ecl_context.ecl_file ?? '')}">${escapeHtml(c.ecl_context.feature)}${c.ecl_context.decisions?.length ? ' / ' + escapeHtml(c.ecl_context.decisions.join(', ')) : ''}</span>` : ''}
      </div>
      <div class="fn-diff" id="${id}">
        ${diffHtml}
      </div>
    </div>
  `;
}

function renderInlineDiff(oldContent: string | null, newContent: string | null): string {
  if (!oldContent && !newContent) {
    return `<div class="diff-empty">No diff content available</div>`;
  }

  const oldLines = (oldContent ?? "").split("\n").filter((l) => l.length > 0);
  const newLines = (newContent ?? "").split("\n").filter((l) => l.length > 0);

  const lines: string[] = [];

  for (const line of oldLines) {
    lines.push(`<div class="diff-line diff-del"><span class="diff-sign">-</span>${escapeHtml(line)}</div>`);
  }
  for (const line of newLines) {
    lines.push(`<div class="diff-line diff-add"><span class="diff-sign">+</span>${escapeHtml(line)}</div>`);
  }

  return `<div class="diff-block">${lines.join("")}</div>`;
}

function buildPage(title: string, session: ReviewSession, groupsHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    :root {
      --bg: #1a1a2e;
      --surface: #16213e;
      --surface2: #0f3460;
      --fg: #eaeaea;
      --fg-dim: #a0a0b0;
      --accent: #4fc3f7;
      --green: #66bb6a;
      --green-bg: #1b3d1b;
      --red: #ef5350;
      --red-bg: #3d1b1b;
      --yellow: #ffca28;
      --yellow-bg: #3d3a1b;
      --blue-bg: #1b2d3d;
      --border: #2a2a4a;
      --radius: 8px;
    }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--fg);
      margin: 0;
      padding: 32px 24px;
      line-height: 1.5;
    }
    .container { max-width: 960px; margin: 0 auto; }

    h1 { color: var(--accent); font-size: 1.5rem; margin-bottom: 8px; }
    .session-meta { color: var(--fg-dim); font-size: 0.85rem; margin-bottom: 24px; }
    .session-meta strong { color: var(--fg); }

    .summary-bar {
      display: flex; gap: 16px; padding: 12px 16px;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius); margin-bottom: 24px; flex-wrap: wrap;
    }
    .summary-stat { font-size: 0.85rem; color: var(--fg-dim); }
    .summary-stat strong { color: var(--accent); font-size: 1.1rem; margin-right: 4px; }

    .reason-group {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      margin-bottom: 16px;
      overflow: hidden;
    }
    .reason-header {
      display: flex; align-items: baseline; gap: 10px;
      padding: 14px 18px;
      cursor: pointer; user-select: none;
      border-bottom: 1px solid transparent;
      transition: background 0.15s;
    }
    .reason-header:hover { background: var(--surface2); }
    .reason-arrow {
      color: var(--accent); font-size: 0.7rem;
      transition: transform 0.2s;
      flex-shrink: 0;
      margin-top: 2px;
    }
    .reason-arrow.collapsed { transform: rotate(-90deg); }
    .reason-text {
      font-size: 0.95rem; font-weight: 600; color: #fff;
      flex: 1;
    }
    .reason-meta {
      font-size: 0.75rem; color: var(--fg-dim);
      white-space: nowrap;
    }
    .reason-body { padding: 0 18px 14px 18px; }
    .reason-body.collapsed { display: none; }

    .file-section { margin-top: 12px; }
    .file-path {
      font-size: 0.8rem; font-family: 'Cascadia Code', 'Fira Code', monospace;
      color: var(--accent); padding: 4px 0;
      border-bottom: 1px solid var(--border);
      margin-bottom: 6px;
    }

    .fn-item { margin-bottom: 2px; }
    .fn-header {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 10px;
      cursor: pointer; user-select: none;
      border-radius: 4px;
      transition: background 0.1s;
    }
    .fn-header:hover { background: var(--surface2); }
    .fn-arrow {
      color: var(--fg-dim); font-size: 0.6rem;
      transition: transform 0.2s;
    }
    .fn-arrow.open { transform: rotate(90deg); }
    .fn-name {
      font-family: 'Cascadia Code', 'Fira Code', monospace;
      font-size: 0.85rem; font-weight: 500; color: #fff;
    }
    .fn-badge {
      font-size: 0.7rem; padding: 1px 7px;
      border-radius: 10px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.3px;
    }
    .fn-badge-add { background: var(--green-bg); color: var(--green); }
    .fn-badge-modify { background: var(--yellow-bg); color: var(--yellow); }
    .fn-badge-delete { background: var(--red-bg); color: var(--red); }
    .fn-badge-rename { background: var(--blue-bg); color: var(--accent); }
    .ecl-tag, .ecl-badge {
      font-size: 0.7rem; padding: 1px 7px;
      border-radius: 10px; font-weight: 500;
      background: #1b2d3d; color: #81d4fa;
      font-family: 'Cascadia Code', 'Fira Code', monospace;
    }
    .ecl-badge { margin-left: auto; }
    .fn-lines { font-size: 0.7rem; color: var(--fg-dim); }

    .fn-diff {
      display: none;
      margin: 4px 0 8px 28px;
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid var(--border);
    }
    .fn-diff.open { display: block; }

    .diff-block {
      font-family: 'Cascadia Code', 'Fira Code', monospace;
      font-size: 0.8rem; line-height: 1.6;
    }
    .diff-line {
      padding: 1px 12px; white-space: pre-wrap; word-break: break-all;
    }
    .diff-del { background: var(--red-bg); color: #ffa4a4; }
    .diff-add { background: var(--green-bg); color: #a4ffa4; }
    .diff-sign { display: inline-block; width: 16px; font-weight: bold; opacity: 0.7; }
    .diff-empty { padding: 12px; color: var(--fg-dim); font-style: italic; font-size: 0.8rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${escapeHtml(title)}</h1>
    <div class="session-meta">
      ${escapeHtml(session.timestamp)} &middot; ${escapeHtml(session.trigger)} trigger
      ${session.summary ? ` &middot; <em>${escapeHtml(session.summary)}</em>` : ""}
    </div>
    <div class="summary-bar">
      <div class="summary-stat"><strong>${session.total_changes}</strong> changes</div>
      <div class="summary-stat"><strong>${session.files_changed.length}</strong> files</div>
    </div>
    ${groupsHtml}
  </div>
  <script>
    function toggleGroup(el) {
      var arrow = el.querySelector('.reason-arrow');
      var body = el.nextElementSibling;
      arrow.classList.toggle('collapsed');
      body.classList.toggle('collapsed');
    }
    function toggleFn(id) {
      var diff = document.getElementById(id);
      var arrow = document.getElementById('arrow-' + id);
      if (diff) { diff.classList.toggle('open'); }
      if (arrow) { arrow.classList.toggle('open'); }
    }
  </script>
</body>
</html>`;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
