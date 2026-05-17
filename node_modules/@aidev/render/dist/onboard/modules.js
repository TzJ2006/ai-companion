import { escapeHtml, escapeAttr, slugify } from "./utils.js";
export function renderModules(modules, reportData) {
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
export function renderFunctionCard(fn, reasonData) {
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
export function renderClassCard(cls, filePath, reasonMap) {
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
//# sourceMappingURL=modules.js.map