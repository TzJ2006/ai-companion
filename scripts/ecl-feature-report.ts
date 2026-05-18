#!/usr/bin/env npx tsx
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const ECL_DIR = join(PROJECT_ROOT, "docs", "ecl");

interface VerificationItem {
  name: string;
  command: string;
  expect?: string;
}

interface FeatureEntry {
  feature: string;
  description: string;
  purpose: string;
  implementation: {
    key_files: string[];
    approach: string;
    constraints: string[];
  };
  verification: VerificationItem[];
}

interface VerificationResult {
  name: string;
  command: string;
  passed: boolean;
  output: string;
  expect?: string;
}

interface FeatureReport {
  feature: string;
  description: string;
  purpose: string;
  file_count: number;
  approach: string;
  constraints: string[];
  results: VerificationResult[];
  status: "pass" | "fail" | "partial";
}

function parseEclYaml(content: string): FeatureEntry[] {
  const features: FeatureEntry[] = [];
  const featureBlocks = content.split(/^  - feature:/m).slice(1);

  for (const block of featureBlocks) {
    const fullBlock = "  - feature:" + block;
    const feature = extractYamlValue(fullBlock, "feature");
    const description = extractYamlValue(fullBlock, "description");
    const purpose = extractYamlValue(fullBlock, "purpose");
    const approach = extractYamlValue(fullBlock, "approach");

    const keyFiles = extractYamlList(fullBlock, "key_files");
    const constraints = extractYamlList(fullBlock, "constraints");
    const verification = extractVerificationItems(fullBlock);

    if (feature && description && purpose) {
      features.push({
        feature,
        description,
        purpose,
        implementation: {
          key_files: keyFiles,
          approach: approach ?? "",
          constraints,
        },
        verification,
      });
    }
  }

  return features;
}

function extractYamlValue(block: string, key: string): string | null {
  const doubleQuote = new RegExp(`${key}:\\s*"([^"]*)"`, "m");
  const singleQuote = new RegExp(`${key}:\\s*'([^']*)'`, "m");
  const match = block.match(doubleQuote) ?? block.match(singleQuote);
  return match ? match[1] : null;
}

function extractYamlList(block: string, key: string): string[] {
  const keyIndex = block.indexOf(`${key}:`);
  if (keyIndex === -1) return [];

  const afterKey = block.slice(keyIndex);
  const lines = afterKey.split("\n").slice(1);
  const items: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- \"") || trimmed.startsWith("- '")) {
      items.push(trimmed.slice(3, -1));
    } else if (trimmed.startsWith("- ")) {
      const value = trimmed.slice(2).replace(/^["']|["']$/g, "");
      items.push(value);
    } else if (trimmed === "" || (!trimmed.startsWith("-") && trimmed.includes(":"))) {
      break;
    }
  }

  return items;
}

function extractVerificationItems(block: string): VerificationItem[] {
  const items: VerificationItem[] = [];
  const verIndex = block.indexOf("verification:");
  if (verIndex === -1) return items;

  const afterVer = block.slice(verIndex);
  const itemBlocks = afterVer.split(/^\s*- name:/m).slice(1);

  for (const itemBlock of itemBlocks) {
    const fullItem = "- name:" + itemBlock;
    const nameMatch = fullItem.match(/- name:\s*(?:"([^"]*)"|'([^']*)')/);
    const cmdMatch = fullItem.match(/command:\s*(?:"([^"]*)"|'([^']*)')/);
    const expMatch = fullItem.match(/expect:\s*(?:"([^"]*)"|'([^']*)')/);

    if (nameMatch && cmdMatch) {
      items.push({
        name: nameMatch[1] ?? nameMatch[2],
        command: cmdMatch[1] ?? cmdMatch[2] ?? "",
        expect: expMatch ? (expMatch[1] ?? expMatch[2]) : undefined,
      });
    }
  }

  return items;
}

function runVerification(item: VerificationItem): VerificationResult {
  try {
    const output = execSync(item.command, {
      cwd: PROJECT_ROOT,
      timeout: 60000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    });

    const passed = item.expect
      ? evaluateExpectation(output, item.expect)
      : true;

    return { name: item.name, command: item.command, passed, output: output.trim(), expect: item.expect };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    const stdout = err.stdout ?? "";
    const stderr = err.stderr ?? "";
    const output = stdout + stderr;

    if (item.expect) {
      const passed = evaluateExpectation(output, item.expect);
      return { name: item.name, command: item.command, passed, output: output.trim().slice(0, 500), expect: item.expect };
    }

    return { name: item.name, command: item.command, passed: false, output: output.trim().slice(0, 500), expect: item.expect };
  }
}

function evaluateExpectation(output: string, expect: string): boolean {
  const lower = expect.toLowerCase();
  if (lower.includes("无输出") || lower.includes("no output")) {
    return output.trim() === "";
  }
  if (lower.includes("只命中") || lower.includes("only")) {
    return output.trim() === "" || output.split("\n").length <= 1;
  }
  if (lower.includes("≤") || lower.includes("<=")) {
    const numMatch = expect.match(/(\d+)/);
    if (numMatch) {
      const limit = parseInt(numMatch[1], 10);
      const lines = output.trim().split("\n");
      return lines.every((line) => {
        const count = parseInt(line.trim().split(/\s+/)[0], 10);
        return isNaN(count) || count <= limit;
      });
    }
  }
  return true;
}

function buildReport(features: FeatureEntry[], dryRun: boolean): FeatureReport[] {
  return features.map((f) => {
    const results = dryRun
      ? f.verification.map((v) => ({ name: v.name, command: v.command, passed: true, output: "(dry run)", expect: v.expect }))
      : f.verification.map((v) => runVerification(v));

    const passCount = results.filter((r) => r.passed).length;
    const status: FeatureReport["status"] =
      passCount === results.length ? "pass" :
      passCount === 0 ? "fail" : "partial";

    return {
      feature: f.feature,
      description: f.description,
      purpose: f.purpose,
      file_count: f.implementation.key_files.length,
      approach: f.implementation.approach,
      constraints: f.implementation.constraints,
      results,
      status,
    };
  });
}

function renderHtml(reports: FeatureReport[]): string {
  const passCount = reports.filter((r) => r.status === "pass").length;
  const totalCount = reports.length;

  const featuresHtml = reports.map((r) => renderFeature(r)).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ECL Feature Report</title>
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
      --border: #2a2a4a;
      --radius: 8px;
    }
    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: var(--bg);
      color: var(--fg);
      margin: 0;
      padding: 32px 24px;
      line-height: 1.5;
    }
    .container { max-width: 960px; margin: 0 auto; }
    h1 { color: var(--accent); font-size: 1.5rem; margin-bottom: 8px; }
    .subtitle { color: var(--fg-dim); font-size: 0.85rem; margin-bottom: 24px; }
    .summary-bar {
      display: flex; gap: 16px; padding: 12px 16px;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius); margin-bottom: 24px; flex-wrap: wrap;
    }
    .summary-stat { font-size: 0.85rem; color: var(--fg-dim); }
    .summary-stat strong { color: var(--accent); font-size: 1.1rem; margin-right: 4px; }
    .feature-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      margin-bottom: 16px;
      overflow: hidden;
    }
    .feature-header {
      display: flex; align-items: center; gap: 12px;
      padding: 14px 18px;
      cursor: pointer; user-select: none;
    }
    .feature-header:hover { background: var(--surface2); }
    .status-badge {
      font-size: 0.7rem; padding: 2px 8px;
      border-radius: 10px; font-weight: 600;
      text-transform: uppercase;
    }
    .status-pass { background: var(--green-bg); color: var(--green); }
    .status-fail { background: var(--red-bg); color: var(--red); }
    .status-partial { background: var(--yellow-bg); color: var(--yellow); }
    .feature-name {
      font-size: 0.95rem; font-weight: 600; color: #fff;
      font-family: 'Cascadia Code', 'Fira Code', monospace;
    }
    .feature-purpose {
      font-size: 0.8rem; color: var(--fg-dim);
      margin-left: auto;
    }
    .feature-body {
      padding: 0 18px 14px 18px;
      display: none;
    }
    .feature-body.open { display: block; }
    .section-label {
      font-size: 0.7rem; text-transform: uppercase;
      color: var(--accent); font-weight: 600;
      margin-top: 12px; margin-bottom: 4px;
    }
    .approach {
      font-size: 0.8rem; color: var(--fg);
      padding: 8px 12px;
      background: var(--surface2);
      border-radius: 4px;
      margin-bottom: 8px;
    }
    .constraint-list {
      list-style: none; padding: 0; margin: 0;
    }
    .constraint-list li {
      font-size: 0.8rem; color: var(--fg-dim);
      padding: 2px 0;
    }
    .constraint-list li::before {
      content: "\\2022"; color: var(--accent);
      margin-right: 8px;
    }
    .verification-item {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 0;
      font-size: 0.8rem;
    }
    .v-icon { font-size: 1rem; }
    .v-pass { color: var(--green); }
    .v-fail { color: var(--red); }
    .v-name { color: var(--fg); }
    .v-cmd {
      font-family: 'Cascadia Code', monospace;
      font-size: 0.7rem; color: var(--fg-dim);
      margin-left: auto;
    }
    .file-count {
      font-size: 0.75rem; color: var(--fg-dim);
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>ECL Feature Report</h1>
    <div class="subtitle">Generated: ${new Date().toISOString()} | Features organized by ECL definition</div>
    <div class="summary-bar">
      <div class="summary-stat"><strong>${passCount}</strong>/<strong>${totalCount}</strong> features passing</div>
      <div class="summary-stat"><strong>${reports.reduce((n, r) => n + r.results.length, 0)}</strong> verification checks</div>
    </div>
    ${featuresHtml}
  </div>
  <script>
    function toggleFeature(el) {
      var body = el.nextElementSibling;
      body.classList.toggle('open');
    }
  </script>
</body>
</html>`;
}

function renderFeature(r: FeatureReport): string {
  const statusClass = `status-${r.status}`;
  const statusLabel = r.status === "pass" ? "PASS" : r.status === "fail" ? "FAIL" : "PARTIAL";

  const verificationsHtml = r.results.map((v) => `
    <div class="verification-item">
      <span class="v-icon ${v.passed ? "v-pass" : "v-fail"}">${v.passed ? "&#10003;" : "&#10007;"}</span>
      <span class="v-name">${escapeHtml(v.name)}</span>
      <span class="v-cmd">${escapeHtml(v.command.length > 60 ? v.command.slice(0, 57) + "..." : v.command)}</span>
    </div>
  `).join("");

  const constraintsHtml = r.constraints.length > 0
    ? `<ul class="constraint-list">${r.constraints.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>`
    : "";

  return `
    <div class="feature-card">
      <div class="feature-header" onclick="toggleFeature(this)">
        <span class="status-badge ${statusClass}">${statusLabel}</span>
        <span class="feature-name">${escapeHtml(r.feature)}</span>
        <span class="file-count">${r.file_count} files</span>
        <span class="feature-purpose">${escapeHtml(r.purpose)}</span>
      </div>
      <div class="feature-body">
        <div class="section-label">Approach</div>
        <div class="approach">${escapeHtml(r.approach)}</div>
        ${r.constraints.length > 0 ? `<div class="section-label">Constraints</div>${constraintsHtml}` : ""}
        <div class="section-label">Verification</div>
        ${verificationsHtml}
      </div>
    </div>
  `;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const dryRun = process.argv.includes("--dry-run");
const outputFile = process.argv.find((a) => a.startsWith("--output="))?.slice(9) ?? "ecl-feature-report.html";

const eclFiles = readdirSync(ECL_DIR).filter((f) => f.endsWith(".yaml"));
const allFeatures: FeatureEntry[] = [];

for (const file of eclFiles) {
  const content = readFileSync(join(ECL_DIR, file), "utf-8");
  if (content.includes("features:")) {
    const features = parseEclYaml(content);
    allFeatures.push(...features);
  }
}

if (allFeatures.length === 0) {
  console.log("No features found in ECL files.");
  process.exit(0);
}

console.log(`Found ${allFeatures.length} features in ECL files.`);
console.log(dryRun ? "Running in dry-run mode (no verification commands executed)." : "Running verification commands...");

const reports = buildReport(allFeatures, dryRun);

for (const r of reports) {
  const icon = r.status === "pass" ? "✓" : r.status === "fail" ? "✗" : "◐";
  console.log(`  ${icon} ${r.feature}: ${r.status.toUpperCase()} (${r.results.filter((v) => v.passed).length}/${r.results.length} checks)`);
}

const html = renderHtml(reports);
writeFileSync(resolve(PROJECT_ROOT, outputFile), html);
console.log(`\nReport written to: ${outputFile}`);
