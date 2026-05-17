import { escapeHtml } from "./utils.js";
export function buildOnboardPage(title, overview, modules, index) {
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

      badge.className = "reason-badge reason-user";
      badge.textContent = "User";
      container.querySelector(".reason-actions")?.remove();
      container.classList.add("reason-confirmed");

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
//# sourceMappingURL=page.js.map