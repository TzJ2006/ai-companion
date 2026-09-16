import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import ts from "typescript";
import { render, type Graph } from "./ideas.js";
import { parse } from "yaml";

const han = /\p{Script=Han}/u;
const prose = new Set(["overview", "name", "what", "why", "expected", "how", "why_this_way", "future", "manual", "pass", "note"]);
type Translations = Record<string, string>;

export function translateGraph(graph: Graph, translate: (text: string) => string): Graph {
  return JSON.parse(JSON.stringify(graph, (key, value) =>
    prose.has(key) && typeof value === "string" && han.test(value) ? translate(value) : value));
}

// Only text and string literals are translated. IDs, attributes used by scripts,
// executable code, paths, and the source graph never pass through the model.
export function localizePage(html: string, translate: (text: string) => string): string {
  const ui = (text: string) => text.split(/(`[^`]*`|"批准 \/ approve \/ 同意")/g).map((part, index) => index % 2 ? part :
    part.replace(/[\p{Script=Han}]+(?:[，。；：、（）「」“”？！—· \t]+[\p{Script=Han}]+)*[，。；：？！]?/gu, translate)).join("");
  const window = new Window({ settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true, disableJavaScriptFileLoading: true } });
  const doc = window.document;
  doc.write(html);
  const walk = (node: any) => {
    if (node.nodeType === 3 && han.test(node.textContent)) node.textContent = ui(node.textContent);
    if (node.nodeType === 1) {
      for (const name of ["title", "aria-label", "placeholder"]) {
        const value = node.getAttribute(name);
        if (value && han.test(value)) node.setAttribute(name, ui(value));
      }
      if (["SCRIPT", "STYLE", "TEXTAREA", "CODE"].includes(node.tagName)) return;
    }
    for (const child of [...node.childNodes]) walk(child);
  };
  walk(doc.documentElement);
  for (const script of doc.querySelectorAll('script:not([type="application/json"])')) {
    const source = script.textContent;
    const file = ts.createSourceFile("page.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const edits: { start: number; end: number; value: string }[] = [];
    const visit = (node: ts.Node) => {
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && han.test(node.text)) {
        edits.push({ start: node.getStart(file), end: node.end, value: JSON.stringify(ui(node.text)).replace(/</g, "\\u003c") });
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    let result = source;
    for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
    script.textContent = result;
  }
  doc.documentElement.lang = "en";
  const result = "<!doctype html>" + doc.documentElement.outerHTML;
  window.happyDOM.abort();
  return result.replace('content:"已改"', 'content:"Changed"');
}

function languageLinks(html: string, english: boolean): string {
  const links = `<nav class="language-switch" aria-label="Language"><a href="graph.zh.html" lang="zh"${english ? "" : ' aria-current="page"'}>中文</a><span> / </span><a href="graph.en.html" lang="en"${english ? ' aria-current="page"' : ""}>English</a></nav>`;
  return html.replace("<body>", "<body>" + links).replace("</style>", `.language-switch { float:right; font-size:13px; position:relative; z-index:3; } .language-switch a { color:#356b58; text-decoration:none; padding:5px; } .language-switch [aria-current] { font-weight:700; text-decoration:underline; text-underline-offset:5px; }\n</style>`)
    .replace("</body>", `<script>document.querySelectorAll('.language-switch a, [data-edit-source]').forEach(a => { const base = a.getAttribute('href'); const sync = () => a.setAttribute('href', base + location.hash); sync(); window.addEventListener('hashchange', sync); });</script></body>`);
}

export async function exportBilingual(directory = resolve("ideas")) {
  const source = readFileSync(resolve(directory, "graph.yaml"), "utf8");
  const graph = parse(source) as Graph;
  const cacheFile = resolve(directory, "graph.en.translations.json");
  const cache: Translations = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};
  const missing = new Set<string>();
  const collect = (text: string) => { if (!cache[text]) missing.add(text); return cache[text] || text; };
  translateGraph(graph, collect);
  // Collect UI separately, with prose replaced, to avoid retranslating excerpts.
  localizePage(render(translateGraph(graph, text => cache[text] || "Translated content")), collect);
  const requestFile = resolve(directory, ".runtime", "translation-requests.json");
  mkdirSync(resolve(directory, ".runtime"), { recursive: true });
  writeFileSync(requestFile, JSON.stringify([...missing], null, 2));
  if (missing.size) {
    console.log(`${missing.size} strings need translation: ${requestFile}\nRun python companion/translate-graph-local.py, then rerun this exporter.`);
    return false;
  }
  const translate = (text: string) => {
    if (!han.test(text)) return text;
    if (!cache[text]) throw new Error(`Missing translation: ${text.slice(0, 100)}`);
    return cache[text];
  };
  const zh = languageLinks(render(graph, source, resolve(directory, "..")), false);
  let en = localizePage(render(translateGraph(graph, translate), "", resolve(directory, "english-reading-copy")), translate);
  // English is a reading copy: translated prose must not become an approval or
  // overwrite the canonical Chinese graph. Navigation and zoom remain available.
  en = en.replace("</style>", '.edit-toggle,.rw-edge,.cut,.sign-open,#new-idea,#restore,#draft-banner,#submit-panel,#sign-panel { display:none !important; }\n</style>');
  en = en.replace("max = max || 12;", "max = max || 32;");
  en = en.replace('<h1 id="page-title">', '<p class="legend">English reading copy · <a data-edit-source href="graph.zh.html">Edit the Chinese source</a></p><h1 id="page-title">');
  writeFileSync(resolve(directory, "graph.zh.html"), zh);
  writeFileSync(resolve(directory, "graph.html"), zh);
  writeFileSync(resolve(directory, "graph.en.html"), languageLinks(en, true));
  console.log(`Wrote Chinese and English HTML (${graph.ideas.length} ideas each).`);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  exportBilingual().catch(error => { console.error(error); process.exitCode = 1; });
}
