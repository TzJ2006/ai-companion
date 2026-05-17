export function renderOverview(totalFunctions, totalFiles, modules, reportData) {
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
//# sourceMappingURL=overview.js.map