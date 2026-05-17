export function renderOnboardHtml(index, options) {
    const title = options.title ?? "Project Onboarding Report";
    const modules = options.modules;
    const reportData = options.reportData;
    const totalFunctions = Object.keys(index.function_index).length;
    const files = [...new Set(Object.values(index.function_index).map(e => e.file_path))];
    const summaryHtml = renderOverview(totalFunctions, files.length, modules, reportData);
    const modulesHtml = renderModules(modules, reportData);
    const indexHtml = renderFunctionIndex(index.function_index);
    return buildOnboardPage(title, summaryHtml, modulesHtml, indexHtml);
}
function renderOverview(totalFunctions, totalFiles, modules, reportData) {
    const totalClasses = modules.reduce((sum, m) => sum + m.classes.length, 0);
    const totalImports = modules.reduce((sum, m) => sum + m.imports.length, 0);
    const testStats = reportData ? `
        <div class="stat-card stat-pass">
          <span class="stat-number">${reportData.tests_passed}</span>
          <span class="stat-label">Tests Passed</span>
        </div>
        <div class="stat-card stat-fail">
          <span class="stat-number">${reportData.tests_failed}</span>
          <span class="stat-label">Tests Failed</span>
        </div>
  ` : "";
    const reasonLegend = reportData ? `
    <div class="reason-legend">
      <h3>Reason Source Legend</h3>
      <div class="legend-items">
        <span class="legend-item"><span class="reason-badge reason-llm">LLM</span> AI-inferred from function signature</span>
        <span class="legend-item"><span class="reason-badge reason-user">User</span> Explicitly provided by developer</span>
        <span class="legend-item"><span class="reason-badge reason-heuristic">Heuristic</span> Rule-based inference from naming conventions</span>
      </div>
    </div>
  ` : "";
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
        ${testStats}
      </div>
      ${reasonLegend}
    </div>
  `;
}
function renderModules(modules, reportData) {
    const sorted = [...modules].sort((a, b) => a.file_path.localeCompare(b.file_path));
    const reasonMap = new Map();
    if (reportData) {
        for (const fr of reportData.functions) {
            const key = `${fr.file_path}::${fr.class_name ?? ""}::${fr.function_name}`;
            reasonMap.set(key, fr);
        }
    }
    const cards = sorted.map(mod => {
        const functionsHtml = mod.functions.map(fn => {
            const key = `${mod.file_path}::${fn.class_name ?? ""}::${fn.name}`;
            return renderFunctionCard(fn, reasonMap.get(key));
        }).join("");
        const classesHtml = mod.classes.map(cls => renderClassCard(cls, mod.file_path, reasonMap)).join("");
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
function renderFunctionCard(fn, reasonData) {
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
    let reasonHtml = "";
    if (reasonData) {
        const badgeClass = `reason-${reasonData.reason_source === "llm-inferred" ? "llm" : reasonData.reason_source === "user-provided" ? "user" : "heuristic"}`;
        const badgeLabel = reasonData.reason_source === "llm-inferred" ? "LLM" : reasonData.reason_source === "user-provided" ? "User" : "Heuristic";
        const fnKey = `${reasonData.file_path}::${reasonData.class_name ?? ""}::${reasonData.function_name}`;
        const actions = reasonData.reason_source !== "user-provided"
            ? `<span class="reason-actions">
           <button class="btn-confirm" onclick="confirmReason(this, '${escapeAttr(fnKey)}')">Confirm</button>
           <button class="btn-edit" onclick="editReason(this, '${escapeAttr(fnKey)}')">Edit</button>
         </span>`
            : "";
        reasonHtml = `
      <div class="fn-reason" data-fn-key="${escapeAttr(fnKey)}">
        <span class="reason-badge ${badgeClass}">${badgeLabel}</span>
        <span class="reason-text">${escapeHtml(reasonData.reason)}</span>
        ${actions}
      </div>
    `;
    }
    let testHtml = "";
    if (reasonData && reasonData.test_file) {
        const statusClass = reasonData.test_status === "passed" ? "test-pass" : "test-fail";
        const statusIcon = reasonData.test_status === "passed" ? "&#x2713;" : "&#x2717;";
        const testDetails = reasonData.test_details.length > 0
            ? `<div class="test-details">${reasonData.test_details.map(td => {
                const icon = td.status === "passed" ? '<span class="test-icon pass">&#x2713;</span>' : '<span class="test-icon fail">&#x2717;</span>';
                const failReason = td.reason ? `<span class="test-fail-reason">${escapeHtml(td.reason)}</span>` : "";
                return `<div class="test-detail-item">${icon} <span class="test-name">${escapeHtml(td.name)}</span>${failReason}</div>`;
            }).join("")}</div>`
            : "";
        testHtml = `
      <div class="fn-test ${statusClass}">
        <span class="test-status-icon">${statusIcon}</span>
        <span class="test-file-name">${escapeHtml(reasonData.test_file)}</span>
        <span class="test-status-badge ${statusClass}">${reasonData.test_status.toUpperCase()}</span>
        ${testDetails}
      </div>
    `;
    }
    else if (reasonData) {
        testHtml = `<div class="fn-test test-none"><span class="test-status-badge test-none">NO TEST</span></div>`;
    }
    return `
    <div class="function-card">
      <div class="function-signature">
        ${decorators}
        ${asyncBadge}
        <span class="fn-name">${escapeHtml(fn.name)}</span>(<span class="fn-params">${params}</span>)${returnType}
      </div>
      ${reasonHtml}
      ${fn.docstring ? `<div class="fn-doc">${escapeHtml(fn.docstring)}</div>` : ""}
      ${testHtml}
      <div class="fn-location">Lines ${fn.start_line}–${fn.end_line}</div>
    </div>
  `;
}
function renderClassCard(cls, filePath, reasonMap) {
    const bases = cls.bases.length > 0 ? ` extends ${cls.bases.map(b => escapeHtml(b)).join(", ")}` : "";
    const methodsHtml = cls.methods.map(m => {
        const key = `${filePath}::${cls.name}::${m.name}`;
        return renderFunctionCard(m, reasonMap.get(key));
    }).join("");
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
<html lang="en" data-generated="${new Date().toISOString()}">
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

    /* Reason styles */
    .fn-reason { margin: 6px 0; display: flex; align-items: center; gap: 8px; }
    .reason-badge { font-size: 0.7em; padding: 2px 8px; border-radius: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
    .reason-llm { background: #1a3a5c; color: #58a6ff; border: 1px solid #2a5a8c; }
    .reason-user { background: #1a3c1a; color: #3fb950; border: 1px solid #2a6c2a; }
    .reason-heuristic { background: #3c2e1a; color: #d29922; border: 1px solid #6c4e2a; }
    .reason-text { font-size: 0.85em; color: #c9d1d9; font-style: italic; }

    .reason-legend { margin-top: 16px; padding: 12px; background: rgba(88, 166, 255, 0.03); border: 1px solid var(--border); border-radius: 6px; }
    .reason-legend h3 { margin: 0 0 8px; font-size: 0.9em; color: #8b949e; }
    .legend-items { display: flex; flex-wrap: wrap; gap: 16px; }
    .legend-item { font-size: 0.82em; color: #8b949e; display: flex; align-items: center; gap: 6px; }

    /* Test result styles */
    .fn-test { margin: 6px 0; padding: 6px 10px; border-radius: 4px; font-size: 0.82em; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .fn-test.test-pass { background: rgba(63, 185, 80, 0.08); border: 1px solid rgba(63, 185, 80, 0.2); }
    .fn-test.test-fail { background: rgba(248, 81, 73, 0.08); border: 1px solid rgba(248, 81, 73, 0.2); }
    .fn-test.test-none { background: rgba(139, 148, 158, 0.08); border: 1px solid rgba(139, 148, 158, 0.2); }
    .test-status-icon { font-size: 1.1em; }
    .test-file-name { font-family: monospace; font-size: 0.9em; color: #8b949e; }
    .test-status-badge { font-size: 0.7em; padding: 2px 6px; border-radius: 8px; font-weight: 600; }
    .test-status-badge.test-pass { background: #1a3c1a; color: #3fb950; }
    .test-status-badge.test-fail { background: #3c1a1a; color: #f85149; }
    .test-status-badge.test-none { background: #2a2a2a; color: #8b949e; }
    .test-details { width: 100%; margin-top: 4px; padding-left: 20px; }
    .test-detail-item { padding: 2px 0; display: flex; align-items: flex-start; gap: 6px; }
    .test-icon { font-weight: bold; }
    .test-icon.pass { color: var(--green); }
    .test-icon.fail { color: var(--red); }
    .test-name { color: #c9d1d9; font-size: 0.9em; }
    .test-fail-reason { color: var(--red); font-size: 0.85em; display: block; margin-top: 2px; font-family: monospace; }

    .stat-pass .stat-number { color: var(--green); }
    .stat-fail .stat-number { color: var(--red); }

    /* Interactive confirm/edit buttons */
    .reason-actions { display: inline-flex; gap: 4px; margin-left: 8px; }
    .reason-actions button { font-size: 0.7em; padding: 2px 8px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: #8b949e; cursor: pointer; transition: all 0.2s; }
    .reason-actions button:hover { border-color: var(--accent); color: var(--accent); }
    .reason-actions button.btn-confirm:hover { border-color: var(--green); color: var(--green); }
    .reason-actions button.btn-edit:hover { border-color: var(--yellow); color: var(--yellow); }
    .reason-confirmed .reason-badge { animation: flash-green 0.5s; }
    @keyframes flash-green { 0% { transform: scale(1); } 50% { transform: scale(1.2); background: #2a6c2a; } 100% { transform: scale(1); } }

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
  <script>
    // Persist confirmed/edited reasons to localStorage
    const STORAGE_KEY = "onboard-report-reasons";

    function loadReasons() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
      catch { return {}; }
    }

    function saveReasons(data) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    function confirmReason(btn, fnKey) {
      const container = btn.closest(".fn-reason");
      const reasonText = container.querySelector(".reason-text").textContent;
      const badge = container.querySelector(".reason-badge");

      // Update visual
      badge.className = "reason-badge reason-user";
      badge.textContent = "User";
      container.querySelector(".reason-actions")?.remove();
      container.classList.add("reason-confirmed");

      // Persist
      const reasons = loadReasons();
      reasons[fnKey] = { reason: reasonText, source: "user-provided", confirmed_at: new Date().toISOString() };
      saveReasons(reasons);
    }

    function editReason(btn, fnKey) {
      const container = btn.closest(".fn-reason");
      const reasonSpan = container.querySelector(".reason-text");
      const currentText = reasonSpan.textContent;

      const input = document.createElement("input");
      input.type = "text";
      input.value = currentText;
      input.style.cssText = "background: var(--bg); border: 1px solid var(--accent); color: var(--fg); padding: 4px 8px; border-radius: 4px; font-size: 0.85em; width: 300px;";

      input.onkeydown = function(e) {
        if (e.key === "Enter") {
          const newText = input.value.trim();
          if (newText) {
            reasonSpan.textContent = newText;
            const badge = container.querySelector(".reason-badge");
            badge.className = "reason-badge reason-user";
            badge.textContent = "User";
            container.querySelector(".reason-actions")?.remove();

            const reasons = loadReasons();
            reasons[fnKey] = { reason: newText, source: "user-provided", confirmed_at: new Date().toISOString() };
            saveReasons(reasons);
          }
          input.replaceWith(reasonSpan);
        } else if (e.key === "Escape") {
          input.replaceWith(reasonSpan);
        }
      };
      input.onblur = () => input.replaceWith(reasonSpan);

      reasonSpan.replaceWith(input);
      input.focus();
      input.select();
    }

    // On load, apply persisted reasons
    (function() {
      const reasons = loadReasons();
      for (const [fnKey, data] of Object.entries(reasons)) {
        const el = document.querySelector(\`[data-fn-key="\${CSS.escape(fnKey)}"]\`);
        if (el) {
          const badge = el.querySelector(".reason-badge");
          const text = el.querySelector(".reason-text");
          if (badge && text) {
            badge.className = "reason-badge reason-user";
            badge.textContent = "User";
            text.textContent = data.reason;
            el.querySelector(".reason-actions")?.remove();
          }
        }
      }
    })();
  </script>
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
function escapeAttr(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/'/g, "&#39;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}
function slugify(text) {
    return text.replace(/[^a-zA-Z0-9]/g, "-");
}
//# sourceMappingURL=onboard-renderer.js.map