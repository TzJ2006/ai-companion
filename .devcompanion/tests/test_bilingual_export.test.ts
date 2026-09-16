import { expect, it } from "vitest";
import { Window } from "happy-dom";
import ts from "typescript";
import { translateGraph, localizePage } from "../../companion/export-bilingual.js";
import { render, type Graph } from "../../companion/ideas.js";

it("translates prose and visible UI without changing identifiers, commands or executable scripts", async () => {
  const graph: Graph = { project: "fixture", ideas: [{ id: "I-001", name: "地基", what: "说明", status: "done",
    code: [{ file: "中文/代码.ts", symbol: "run" }], verify: { command: 'echo "中文"', manual: "手动检查" } }] };
  const translated = translateGraph(graph, text => ({ 地基: "Foundation", 说明: '<img src=x onerror="bad()">', 手动检查: "Manual check" })[text] || text);
  expect(translated.ideas[0].code).toEqual(graph.ideas[0].code);
  expect(translated.ideas[0].verify?.command).toBe(graph.ideas[0].verify?.command);
  expect(graph.ideas[0].name).toBe("地基");
  const html = localizePage(render(translated), () => 'English "label" <safe>');
  const window = new Window({ settings: { disableJavaScriptEvaluation: true } });
  window.document.write(html);
  expect(window.document.documentElement.lang).toBe("en");
  expect(window.document.querySelectorAll("img")).toHaveLength(0);
  expect([...window.document.querySelectorAll("code")].map(node => node.textContent)).toContain('echo "中文"');
  const data = JSON.parse(window.document.querySelector("#graph-data")!.textContent);
  expect(data).toEqual(translated);
  for (const script of window.document.querySelectorAll('script:not([type="application/json"])')) {
    const parsed = ts.createSourceFile("page.js", script.textContent, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    expect((parsed as any).parseDiagnostics).toHaveLength(0);
  }
  const classic = [...window.document.querySelectorAll('script:not([type])')].map(s => s.textContent).join("\n");
  const editing = window.document.querySelector('script[type="module"]')!.textContent;
  new Function("window", "document", "localStorage", "location", classic + editing)(window, window.document, window.localStorage, window.location);
  window.location.hash = "#I-001";
  window.dispatchEvent(new window.Event("hashchange"));
  expect(window.document.querySelector("#page-title")!.textContent).toBe("Foundation");
  await window.happyDOM.abort();
});
