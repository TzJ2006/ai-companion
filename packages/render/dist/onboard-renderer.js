export function renderOnboardHtml(index, options) {
    const title = options.title ?? "Project Onboarding Report";
    const modules = options.modules;
    const totalFunctions = Object.keys(index.function_index).length;
    const files = [...new Set(Object.values(index.function_index).map(e => e.file_path))];
    const summaryHtml = renderOverview(totalFunctions, files.length, modules);
    const modulesHtml = renderModules(modules);
    const indexHtml = renderFunctionIndex(index.function_index);
    return buildOnboardPage(title, summaryHtml, modulesHtml, indexHtml);
}
function renderOverview(totalFunctions, totalFiles, modules) {
    const totalClasses = modules.reduce((sum, m) => sum + m.classes.length, 0);
    const totalImports = modules.reduce((sum, m) => sum + m.imports.length, 0);
    return `
    <div class="overview-panel">
      <h2>Project Overview</h2>
      <div class="stats-grid">
        <div class="stat-card">
          <span class="stat-number">${totalFiles}</span>
          <span class="stat-label">Source Files</span>
        </div>
        <div class="stat-card">
          <span class="stat-number">${totalFunctions}</span>
          <span class="stat-label">Functions</span>
        </div>
        <div class="stat-card">
          <span class="stat-number">${totalClasses}</span>
          <span class="stat-label">Classes</span>
        </div>
        <div class="stat-card">
          <span class="stat-number">${totalImports}</span>
          <span class="stat-label">Import Statements</span>
        </div>
      </div>
    </div>
  `;
}
function renderModules(modules) {
    const sorted = [...modules].sort((a, b) => a.file_path.localeCompare(b.file_path));
    const cards = sorted.map(mod => {
        const functionsHtml = mod.functions.map(fn => renderFunctionCard(fn)).join("");
        const classesHtml = mod.classes.map(cls => renderClassCard(cls)).join("");
        const counts = [];
        if (mod.functions.length > 0)
            counts.push(`${mod.functions.length} functions`);
        if (mod.classes.length > 0)
            counts.push(`${mod.classes.length} classes`);
        if (mod.imports.length > 0)
            counts.push(`${mod.imports.length} imports`);
        return `
      <div class="module-card" id="file-${slugify(mod.file_path)}">
        <div class="module-header">
          <h3><code>${escapeHtml(mod.file_path)}</code></h3>
          <span class="module-stats">${counts.join(" · ")}</span>
        </div>
        <div class="module-body">
          ${classesHtml}
          ${functionsHtml}
        </div>
      </div>
    `;
    });
    return `
    <div class="modules-section">
      <h2>File Breakdown</h2>
      ${cards.join("\n")}
    </div>
  `;
}
function renderFunctionCard(fn) {
    const params = fn.params.map(p => {
        let s = p.name;
        if (p.type)
            s += `: ${p.type}`;
        if (p.default_value)
            s += ` = ${p.default_value}`;
        if (p.is_args)
            s = `...${s}`;
        return escapeHtml(s);
    }).join(", ");
    const returnType = fn.return_type ? `: ${escapeHtml(fn.return_type)}` : "";
    const asyncBadge = fn.is_async ? '<span class="badge badge-async">async</span>' : "";
    const decorators = fn.decorators.length > 0
        ? fn.decorators.map(d => `<span class="decorator">@${escapeHtml(d)}</span>`).join(" ")
        : "";
    return `
    <div class="function-card">
      <div class="function-signature">
        ${decorators}
        ${asyncBadge}
        <span class="fn-name">${escapeHtml(fn.name)}</span>(<span class="fn-params">${params}</span>)${returnType}
      </div>
      ${fn.docstring ? `<div class="fn-doc">${escapeHtml(fn.docstring)}</div>` : ""}
      <div class="fn-location">Lines ${fn.start_line}–${fn.end_line}</div>
    </div>
  `;
}
function renderClassCard(cls) {
    const bases = cls.bases.length > 0 ? ` extends ${cls.bases.map(b => escapeHtml(b)).join(", ")}` : "";
    const methodsHtml = cls.methods.map(m => renderFunctionCard(m)).join("");
    return `
    <div class="class-card">
      <div class="class-header">
        <span class="class-keyword">class</span>
        <span class="class-name">${escapeHtml(cls.name)}</span>${bases}
        <span class="class-stats">${cls.methods.length} methods</span>
      </div>
      <div class="class-methods">
        ${methodsHtml}
      </div>
    </div>
  `;
}
function renderFunctionIndex(functionIndex) {
    const entries = Object.values(functionIndex).sort((a, b) => a.file_path.localeCompare(b.file_path));
    const byFile = new Map();
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
function buildOnboardPage(title, overview, modules, index) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #0d1117;
      --fg: #c9d1d9;
      --border: #30363d;
      --accent: #58a6ff;
      --green: #3fb950;
      --red: #f85149;
      --yellow: #d29922;
      --purple: #bc8cff;
      --card-bg: #161b22;
    }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--fg); margin: 0; padding: 20px; line-height: 1.5; }
    h1 { color: var(--accent); border-bottom: 1px solid var(--border); padding-bottom: 10px; }
    h2 { color: var(--accent); margin-top: 30px; }
    .layout { display: grid; grid-template-columns: 1fr 280px; gap: 24px; max-width: 1600px; margin: 0 auto; }
    .main-content { min-width: 0; }
    .sidebar { position: sticky; top: 20px; align-self: start; max-height: calc(100vh - 40px); overflow-y: auto; }

    .overview-panel { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin-bottom: 20px; }
    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-top: 16px; }
    .stat-card { text-align: center; padding: 16px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; }
    .stat-number { display: block; font-size: 2em; font-weight: bold; color: var(--accent); }
    .stat-label { font-size: 0.85em; color: #8b949e; }

    .module-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 16px; overflow: hidden; }
    .module-header { padding: 12px 16px; background: rgba(88, 166, 255, 0.05); border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
    .module-header h3 { margin: 0; font-size: 0.95em; }
    .module-stats { font-size: 0.8em; color: #8b949e; }
    .module-body { padding: 12px 16px; }

    .function-card { padding: 8px 12px; margin: 6px 0; border-left: 3px solid var(--accent); background: rgba(88, 166, 255, 0.03); border-radius: 0 4px 4px 0; }
    .function-signature { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.88em; }
    .fn-name { color: var(--green); font-weight: bold; }
    .fn-params { color: #8b949e; }
    .fn-doc { font-size: 0.82em; color: #8b949e; font-style: italic; margin-top: 4px; }
    .fn-location { font-size: 0.75em; color: #484f58; margin-top: 2px; }

    .class-card { margin: 12px 0; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
    .class-header { padding: 8px 12px; background: rgba(188, 140, 255, 0.08); border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 8px; }
    .class-keyword { color: var(--purple); font-family: monospace; }
    .class-name { color: var(--yellow); font-weight: bold; font-family: monospace; }
    .class-stats { font-size: 0.8em; color: #8b949e; margin-left: auto; }
    .class-methods { padding: 8px 12px; }

    .badge { font-size: 0.72em; padding: 2px 6px; border-radius: 10px; vertical-align: middle; }
    .badge-async { background: #1a2a3a; color: var(--accent); }
    .decorator { font-size: 0.8em; color: var(--yellow); margin-right: 4px; }

    .index-panel { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
    .index-panel h2 { margin-top: 0; font-size: 1em; }
    .index-file { margin-bottom: 12px; }
    .index-file a { color: var(--accent); text-decoration: none; font-size: 0.85em; }
    .index-file a:hover { text-decoration: underline; }
    .index-file ul { list-style: none; padding-left: 12px; margin: 4px 0; }
    .index-file li { font-size: 0.8em; padding: 2px 0; }
    .hash { color: #484f58; font-size: 0.85em; font-family: monospace; }

    code { background: #1a1a2e; padding: 2px 5px; border-radius: 3px; font-size: 0.88em; }

    @media (max-width: 1024px) {
      .layout { grid-template-columns: 1fr; }
      .sidebar { position: static; max-height: none; }
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="layout">
    <div class="main-content">
      ${overview}
      ${modules}
    </div>
    <div class="sidebar">
      ${index}
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
function slugify(text) {
    return text.replace(/[^a-zA-Z0-9]/g, "-");
}
//# sourceMappingURL=onboard-renderer.js.map