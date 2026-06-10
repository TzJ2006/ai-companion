const container = document.getElementById("projects-container");
const searchInput = document.getElementById("search");
const statsEl = document.getElementById("stats");
const projectNav = document.getElementById("project-nav");
const addBtn = document.getElementById("add-btn");
const addDialog = document.getElementById("add-dialog");
const addForm = document.getElementById("add-form");
const cancelBtn = document.getElementById("cancel-btn");
const addError = document.getElementById("add-error");
const exportBtn = document.getElementById("export-btn");
const exportDialog = document.getElementById("export-dialog");
const exportForm = document.getElementById("export-form");
const exportCancelBtn = document.getElementById("export-cancel-btn");
const exportResult = document.getElementById("export-result");

let projectsData = [];
let sshReposData = [];
let sshReposDir = null;
let activeProject = null;

async function fetchProjects() {
  try {
    const response = await fetch("/api/projects");
    const data = await response.json();
    projectsData = data.projects;
    sshReposData = data.sshRepos || [];
    sshReposDir = data.sshReposDir || null;
    renderNav();
    renderContent();
    updateStats();
  } catch (error) {
    container.innerHTML = `<div class="empty-state"><h3>Connection Error</h3><p>${error.message}</p></div>`;
  }
}

function updateStats() {
  const totalReports = projectsData.reduce((sum, p) => sum + p.reports.length, 0);
  const activeProjects = projectsData.filter((p) => p.reports.length > 0).length;
  statsEl.textContent = `${activeProjects} projects / ${totalReports} reports`;
}

function renderNav() {
  const items = projectsData.map((project) => {
    const isActive = activeProject === project.name;
    return `<div class="nav-item ${isActive ? "active" : ""}" data-project="${esc(project.name)}">
      <span>${esc(project.name)}</span>
      <span class="count">${project.reports.length}</span>
    </div>`;
  });

  projectNav.innerHTML = `
    <div class="nav-item ${!activeProject ? "active" : ""}" data-project="">
      <span>All Projects</span>
      <span class="count">${projectsData.reduce((s, p) => s + p.reports.length, 0)}</span>
    </div>
    ${items.join("")}`;

  projectNav.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", () => {
      const name = item.dataset.project;
      activeProject = name || null;
      renderNav();
      renderContent();
    });
  });
}

function renderContent() {
  const query = searchInput.value.toLowerCase().trim();

  let filtered = projectsData;
  if (activeProject) {
    filtered = filtered.filter((p) => p.name === activeProject);
  }

  filtered = filtered
    .map((project) => {
      const reports = project.reports.filter(
        (r) =>
          r.name.toLowerCase().includes(query) ||
          r.relativePath.toLowerCase().includes(query) ||
          project.name.toLowerCase().includes(query)
      );
      return { ...project, reports };
    })
    .filter((p) => p.reports.length > 0 || (!query && !activeProject));

  if (filtered.length === 0 && projectsData.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No projects added</h3>
        <p>Click "Add Project" in the sidebar to get started.</p>
      </div>`;
    return;
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state"><h3>No matches</h3><p>Try a different search term.</p></div>`;
    return;
  }

  let html = filtered
    .map((project) => `
      <section class="project-section">
        <div class="project-header">
          <h2>${esc(project.name)}</h2>
          <span class="path">${esc(project.path)}</span>
          <button class="remove-btn" onclick="removeProject('${esc(project.name)}')">Remove</button>
        </div>
        ${project.reports.length > 0
          ? `<div class="reports-grid">${project.reports.map((r) => reportCard(project.name, r)).join("")}</div>`
          : `<div class="empty-state" style="padding:2rem"><p>No HTML reports found.</p></div>`
        }
      </section>`)
    .join("");

  if (sshReposData.length > 0 && !activeProject) {
    const sshFiltered = sshReposData
      .map((project) => {
        const reports = project.reports.filter(
          (r) => r.name.toLowerCase().includes(query) || project.name.toLowerCase().includes(query)
        );
        return { ...project, reports };
      })
      .filter((p) => p.reports.length > 0 || !query);

    if (sshFiltered.length > 0) {
      html += `
        <details class="ssh-section">
          <summary class="ssh-header">
            <span>SSH Repos</span>
            <span class="count">${sshFiltered.reduce((s, p) => s + p.reports.length, 0)} reports</span>
          </summary>
          <div class="ssh-content">
            ${sshFiltered.map((project) => `
              <section class="project-section">
                <div class="project-header">
                  <h2>${esc(project.name)}</h2>
                </div>
                ${project.reports.length > 0
                  ? `<div class="reports-grid">${project.reports.map((r) => reportCard(project.name, r)).join("")}</div>`
                  : `<div class="empty-state" style="padding:2rem"><p>No HTML reports.</p></div>`
                }
              </section>`).join("")}
          </div>
        </details>`;
    }
  }

  container.innerHTML = html;
}

function reportCard(projectName, report) {
  const date = new Date(report.modifiedAt);
  const formatted = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const size = formatSize(report.sizeBytes);
  const dirHint = report.relativePath.includes("/")
    ? report.relativePath.substring(0, report.relativePath.lastIndexOf("/"))
    : "";

  const url = `/api/reports/${encodeURIComponent(projectName)}/${report.relativePath}`;

  return `
    <a class="report-card" href="${url}" target="_blank">
      ${dirHint ? `<div class="path-hint">${esc(dirHint)}/</div>` : ""}
      <div class="name">${esc(report.name)}</div>
      <div class="meta">
        <span>${formatted}</span>
        <span>${size}</span>
      </div>
    </a>`;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

function esc(text) {
  const el = document.createElement("span");
  el.textContent = text;
  return el.innerHTML;
}

async function removeProject(name) {
  if (!confirm(`Remove "${name}" from dashboard?`)) return;
  await fetch(`/api/projects/${encodeURIComponent(name)}`, { method: "DELETE" });
  if (activeProject === name) activeProject = null;
  await fetchProjects();
}

searchInput.addEventListener("input", () => renderContent());

addBtn.addEventListener("click", () => {
  addError.hidden = true;
  addDialog.showModal();
});

cancelBtn.addEventListener("click", () => addDialog.close());

addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = document.getElementById("project-name").value.trim();
  const path = document.getElementById("project-path").value.trim();
  if (!name || !path) return;

  try {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, path }),
    });
    if (!res.ok) {
      const data = await res.json();
      addError.textContent = data.error;
      addError.hidden = false;
      return;
    }
    addDialog.close();
    addForm.reset();
    await fetchProjects();
  } catch (err) {
    addError.textContent = err.message;
    addError.hidden = false;
  }
});

exportBtn.addEventListener("click", () => {
  exportResult.hidden = true;
  exportDialog.showModal();
});

exportCancelBtn.addEventListener("click", () => exportDialog.close());

exportForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const dir = document.getElementById("export-path").value.trim();
  if (!dir) return;

  exportResult.textContent = "Exporting...";
  exportResult.hidden = false;
  exportResult.style.color = "var(--text-secondary)";

  try {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outputDir: dir }),
    });
    const data = await res.json();
    if (data.success) {
      exportResult.style.color = "var(--success)";
      exportResult.textContent = `Exported ${data.exported} reports to ${data.outputDir}`;
    } else {
      exportResult.style.color = "var(--danger)";
      exportResult.textContent = data.error || "Export failed";
    }
  } catch (err) {
    exportResult.style.color = "var(--danger)";
    exportResult.textContent = err.message;
  }
});

const sshBtn = document.getElementById("ssh-btn");
const sshDialog = document.getElementById("ssh-dialog");
const sshForm = document.getElementById("ssh-form");
const sshCancelBtn = document.getElementById("ssh-cancel-btn");
const sshError = document.getElementById("ssh-error");

sshBtn.addEventListener("click", () => {
  sshError.hidden = true;
  if (sshReposDir) {
    document.getElementById("ssh-path").value = sshReposDir;
  }
  sshDialog.showModal();
});

sshCancelBtn.addEventListener("click", () => sshDialog.close());

sshForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const path = document.getElementById("ssh-path").value.trim();
  if (!path) return;

  try {
    const res = await fetch("/api/ssh-repos-dir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) {
      const data = await res.json();
      sshError.textContent = data.error;
      sshError.hidden = false;
      return;
    }
    sshDialog.close();
    await fetchProjects();
  } catch (err) {
    sshError.textContent = err.message;
    sshError.hidden = false;
  }
});

fetchProjects();
