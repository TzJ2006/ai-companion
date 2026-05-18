import { writeFileSync } from "node:fs";

interface TestDesignEntry {
  test_file: string;
  module: string;
  strategy: string;
  mock_approach: string;
  test_count: number;
  coverage_target: string;
  ecl_decisions?: string[];
  categories: { name: string; description: string; count: number }[];
}

const testDesign: TestDesignEntry[] = [
  {
    test_file: "test_diff_annotator.test.ts",
    module: "@aidev/core (diff/annotator)",
    strategy: "Pure unit tests with builder helpers (makeHunk, makeFileDiff, makeFn). No I/O, no WASM.",
    mock_approach: "Mock computeFunctionIdentity to return deterministic hashes; mock randomUUID for stable IDs.",
    test_count: 18,
    coverage_target: "annotateChanges, toChangeRecords, deduplicateByFunction",
    categories: [
      { name: "Function matching", description: "Hunk line ranges correctly map to function boundaries", count: 6 },
      { name: "Change type inference", description: "add/modify/delete/rename inferred from FileDiff.status", count: 4 },
      { name: "Deduplication", description: "Multiple hunks in same function merge into one AnnotatedChange", count: 3 },
      { name: "Module-level fallback", description: "Changes outside any function get <module-level> label", count: 3 },
      { name: "ECL context passthrough", description: "ecl_context from AnnotationContext propagates to records", count: 2 },
    ],
  },
  {
    test_file: "test_hook_handlePostToolUse.test.ts",
    module: "@aidev/hook",
    strategy: "Guard-condition testing: verify the filter chain (tool type → extension → project root) rejects invalid inputs early.",
    mock_approach: "Mock node:fs (existsSync, appendFileSync, mkdirSync). No real filesystem.",
    test_count: 10,
    coverage_target: "handlePostToolUse, findProjectRoot",
    categories: [
      { name: "Input rejection", description: "Non-JSON, wrong tool_name, unsupported extension", count: 4 },
      { name: "Extension filtering", description: "Default .ts/.py accepted; custom extensions respected", count: 3 },
      { name: "Project root discovery", description: "Walk up directories looking for .devcompanion or .git", count: 3 },
    ],
  },
  {
    test_file: "test_daemon_processor.test.ts",
    module: "@aidev/daemon (processor)",
    strategy: "Early-exit boundary testing: verify all abort conditions before the expensive parse/annotate pipeline runs.",
    mock_approach: "Mock node:fs/promises, @aidev/core, @aidev/ast. Test only the orchestration logic, not the sub-systems.",
    test_count: 4,
    coverage_target: "processQueue early-exit paths",
    ecl_decisions: ["DEC-001: Mock nodes over module mocks"],
    categories: [
      { name: "File missing", description: "Return early if queue file doesn't exist", count: 1 },
      { name: "Rename race", description: "Return early if atomic rename fails (another processor owns it)", count: 1 },
      { name: "Empty queue", description: "Return early if file is empty after rename", count: 1 },
      { name: "No relevant diffs", description: "Skip save if git diff has no matching files (integration, skipped)", count: 1 },
    ],
  },
  {
    test_file: "test_ast_computeFunctionIdentity.test.ts",
    module: "@aidev/ast (identity)",
    strategy: "Property-based: verify hash stability, uniqueness, and the contract (same inputs → same hash; different inputs → different hash).",
    mock_approach: "No mocks — computeFunctionIdentity is pure (crypto.createHash). Test against real SHA-256.",
    test_count: 34,
    coverage_target: "computeFunctionIdentity — all hash dimensions",
    categories: [
      { name: "Structural correctness", description: "Return type has hash, file_path, function_name, class_name, param_signature", count: 4 },
      { name: "Hash stability", description: "Same inputs always produce same 16-char hex hash", count: 5 },
      { name: "Sensitivity to file_path", description: "Same function in different files → different hash", count: 3 },
      { name: "Sensitivity to class_name", description: "Method vs standalone function → different hash", count: 4 },
      { name: "Sensitivity to params", description: "Adding/changing param types changes the hash", count: 8 },
      { name: "Insensitivity to line numbers", description: "Moving function (same content) keeps same hash", count: 4 },
      { name: "Insensitivity to body", description: "Changing function body doesn't change identity hash", count: 3 },
      { name: "Edge cases", description: "Empty params, unicode names, very long paths", count: 3 },
    ],
  },
  {
    test_file: "test_store_HistoryStore.test.ts",
    module: "@aidev/history (store)",
    strategy: "State-machine testing: init → saveSession → getFileHistory → getIndex. Verify JSON read/write orchestration.",
    mock_approach: "Mock node:fs and node:fs/promises. Dynamic import after mocks to ensure interception.",
    test_count: 12,
    coverage_target: "HistoryStore.init, saveSession, getFileHistory, getIndex",
    categories: [
      { name: "Initialization", description: "Creates directories, writes initial index.json, ensures .gitignore entry", count: 4 },
      { name: "Session persistence", description: "Saves review JSON, appends to file history, updates index", count: 4 },
      { name: "Index management", description: "Increments counters, updates function_index entries", count: 2 },
      { name: "File history", description: "Groups changes by function_hash, maintains prev_hashes", count: 2 },
    ],
  },
  {
    test_file: "ts-parser-internal.test.ts",
    module: "@aidev/ast (ts-parser internals)",
    strategy: "Mock SyntaxNode objects — test extraction logic WITHOUT loading WASM. DEC-001 from wasm-testing-strategy.",
    mock_approach: "Build mock SyntaxNode trees in-memory. No vi.mock('web-tree-sitter'). Pure function testing.",
    test_count: 34,
    coverage_target: "extractTsFunction, extractTsClass, extractTsParams, cleanTypeAnnotation, etc.",
    ecl_decisions: ["DEC-001: Mock SyntaxNode over module mock", "DEC-002: Export with @internal JSDoc"],
    categories: [
      { name: "Function extraction", description: "Arrow, named, async, generator functions", count: 10 },
      { name: "Class extraction", description: "Classes with methods, decorators, heritage", count: 6 },
      { name: "Param parsing", description: "Types, defaults, destructuring, rest params", count: 8 },
      { name: "Type cleaning", description: "Remove annotations, handle generics, nullable", count: 5 },
      { name: "JSDoc extraction", description: "Block comments → docstring", count: 5 },
    ],
  },
];

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderTestDesignReport(entries: TestDesignEntry[]): string {
  const totalTests = entries.reduce((sum, e) => sum + e.test_count, 0);
  const totalFiles = entries.length;

  const entriesHtml = entries.map((entry) => {
    const categoriesHtml = entry.categories.map((cat) => `
      <div class="cat-row">
        <span class="cat-name">${escapeHtml(cat.name)}</span>
        <span class="cat-count">${cat.count}</span>
        <span class="cat-desc">${escapeHtml(cat.description)}</span>
      </div>
    `).join("");

    const eclHtml = entry.ecl_decisions
      ? entry.ecl_decisions.map((d) => `<span class="ecl-badge">${escapeHtml(d)}</span>`).join(" ")
      : "";

    return `
    <div class="test-entry">
      <div class="entry-header" onclick="toggleEntry(this)">
        <span class="entry-arrow">&#9660;</span>
        <span class="entry-file">${escapeHtml(entry.test_file)}</span>
        <span class="entry-count">${entry.test_count} tests</span>
        <span class="entry-module">${escapeHtml(entry.module)}</span>
      </div>
      <div class="entry-body open">
        <div class="entry-section">
          <div class="section-label">Strategy</div>
          <div class="section-value">${escapeHtml(entry.strategy)}</div>
        </div>
        <div class="entry-section">
          <div class="section-label">Mock Approach</div>
          <div class="section-value">${escapeHtml(entry.mock_approach)}</div>
        </div>
        <div class="entry-section">
          <div class="section-label">Coverage Target</div>
          <div class="section-value"><code>${escapeHtml(entry.coverage_target)}</code></div>
        </div>
        ${eclHtml ? `<div class="entry-section"><div class="section-label">ECL Decisions</div><div class="section-value">${eclHtml}</div></div>` : ""}
        <div class="entry-section">
          <div class="section-label">Test Categories</div>
          <div class="cat-grid">${categoriesHtml}</div>
        </div>
      </div>
    </div>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test Design Report — AI Dev Companion</title>
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
      --purple: #ce93d8;
      --purple-bg: #2d1b3d;
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
    .container { max-width: 1000px; margin: 0 auto; }

    h1 { color: var(--accent); font-size: 1.5rem; margin-bottom: 4px; }
    .subtitle { color: var(--fg-dim); font-size: 0.85rem; margin-bottom: 24px; }

    .summary-bar {
      display: flex; gap: 20px; padding: 14px 18px;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius); margin-bottom: 28px; flex-wrap: wrap;
    }
    .summary-stat { font-size: 0.85rem; color: var(--fg-dim); }
    .summary-stat strong { color: var(--accent); font-size: 1.2rem; margin-right: 4px; }

    .test-entry {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      margin-bottom: 14px;
      overflow: hidden;
    }
    .entry-header {
      display: flex; align-items: center; gap: 10px;
      padding: 14px 18px;
      cursor: pointer; user-select: none;
      transition: background 0.15s;
    }
    .entry-header:hover { background: var(--surface2); }
    .entry-arrow {
      color: var(--accent); font-size: 0.7rem;
      transition: transform 0.2s;
      flex-shrink: 0;
    }
    .entry-arrow.collapsed { transform: rotate(-90deg); }
    .entry-file {
      font-family: 'Cascadia Code', 'Fira Code', monospace;
      font-size: 0.85rem; font-weight: 600; color: #fff;
    }
    .entry-count {
      font-size: 0.7rem; padding: 2px 8px;
      border-radius: 10px; font-weight: 600;
      background: var(--green-bg); color: var(--green);
    }
    .entry-module {
      font-size: 0.75rem; color: var(--fg-dim);
      margin-left: auto;
    }

    .entry-body { padding: 0 18px 16px 18px; }
    .entry-body.collapsed { display: none; }

    .entry-section { margin-top: 12px; }
    .section-label {
      font-size: 0.7rem; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.5px;
      color: var(--purple); margin-bottom: 4px;
    }
    .section-value {
      font-size: 0.85rem; color: var(--fg);
      padding-left: 12px;
      border-left: 2px solid var(--border);
    }
    .section-value code {
      font-family: 'Cascadia Code', 'Fira Code', monospace;
      font-size: 0.8rem; color: var(--accent);
    }

    .ecl-badge {
      display: inline-block;
      font-size: 0.7rem; padding: 2px 8px;
      border-radius: 10px; font-weight: 500;
      background: #1b2d3d; color: #81d4fa;
      font-family: 'Cascadia Code', 'Fira Code', monospace;
      margin-right: 6px;
    }

    .cat-grid { margin-top: 6px; }
    .cat-row {
      display: grid;
      grid-template-columns: 180px 36px 1fr;
      gap: 8px;
      padding: 5px 12px;
      border-radius: 4px;
      align-items: center;
      font-size: 0.8rem;
    }
    .cat-row:nth-child(odd) { background: rgba(79, 195, 247, 0.03); }
    .cat-name {
      font-weight: 500; color: #fff;
    }
    .cat-count {
      text-align: center;
      font-size: 0.7rem; font-weight: 700;
      color: var(--yellow);
      background: var(--yellow-bg);
      border-radius: 8px;
      padding: 1px 0;
    }
    .cat-desc { color: var(--fg-dim); }
  </style>
</head>
<body>
  <div class="container">
    <h1>Test Design Report</h1>
    <div class="subtitle">AI Dev Companion — How tests are designed and why</div>
    <div class="summary-bar">
      <div class="summary-stat"><strong>${totalTests}</strong> tests total</div>
      <div class="summary-stat"><strong>${totalFiles}</strong> test files analyzed</div>
      <div class="summary-stat"><strong>3</strong> mock strategies</div>
      <div class="summary-stat"><strong>2</strong> ECL decisions applied</div>
    </div>
    ${entriesHtml}
  </div>
  <script>
    function toggleEntry(el) {
      var arrow = el.querySelector('.entry-arrow');
      var body = el.nextElementSibling;
      arrow.classList.toggle('collapsed');
      body.classList.toggle('collapsed');
    }
  </script>
</body>
</html>`;
}

const html = renderTestDesignReport(testDesign);
writeFileSync("demo-test-design-report.html", html);
console.log("Written: demo-test-design-report.html");
