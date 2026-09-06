import { describe, it, expect } from "vitest";
import { Window } from "happy-dom";
import { parseDocument } from "yaml";
import { render, topoOrder, type Graph } from "../../companion/ideas.js";

// The tree on the page (FORMAT.md, "The tree"): one page per idea, addressed
// by hash. The home page lists the top-level ideas; an idea's page carries its
// own full card on top and a row per child below; the shared diagram shows the
// current page's children. Siblings stay in dependency order (I-060/I-061).
describe("render: one page per idea, siblings in dependency order", () => {
  // Written deliberately backwards: the endpoint first, the foundation last.
  const yaml = `version: 1
project: fixture
endpoints: [I-003]
ideas:
  - id: I-003
    name: "终点"
    status: todo
    needs: [I-002]
    parent: I-010
  - id: I-002
    name: "中间"
    status: todo
    needs: [I-001]
    parent: I-010
  - id: I-001
    name: "地基"
    status: done
    needs: []
    parent: I-010
    what: 第一行
  - id: I-010
    name: "第一大步"
    status: todo
    needs: []
  - id: I-020
    name: "第二大步"
    status: todo
    needs: []
  - id: I-099
    name: "父想法丢了"
    status: todo
    needs: []
    parent: I-404
`;
  const graphOf = (text: string) => parseDocument(text).toJSON() as Graph;

  const open = (html: string) => {
    const window = new Window({ url: "file:///D:/p/ideas/graph.html" });
    window.document.write("<!doctype html><html><body></body></html>");
    window.document.body.innerHTML = html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>"));
    return window.document;
  };
  // I-117：一行是一个带 data-row 的折叠元素，「进入」链接在它的概要行里带 data-brief。
  const rows = (doc: ReturnType<typeof open>, page: string) =>
    [...doc.querySelectorAll(`#page-${page} .children details[data-row]`)].map((d) => d.getAttribute("data-row"));

  const html = render(graphOf(yaml), yaml);
  const doc = open(html);

  it("the home page lists the top-level ideas — and an idea whose parent is missing lands there too", () => {
    expect(rows(doc, "root")).toEqual(["I-010", "I-020", "I-099"]);
  });

  it("an idea's page carries its own card and a row per child, in dependency order", () => {
    const page = doc.getElementById("page-I-010")!;
    expect(page.querySelector("section.idea")!.id).toBe("I-010");
    expect(rows(doc, "I-010")).toEqual(["I-001", "I-002", "I-003"]);
    expect(rows(doc, "I-010")).toEqual(topoOrder(graphOf(yaml)).filter((i) => i.parent === "I-010").map((i) => i.id));
    expect(page.querySelector('[data-brief="I-001"]')!.getAttribute("href")).toBe("#I-001");
    expect(page.querySelector('[data-row="I-001"] .blurb')!.textContent).toBe("第一行");
  });

  it("every idea's full card appears exactly once, on its own page", () => {
    for (const id of ["I-001", "I-002", "I-003", "I-010", "I-020", "I-099"]) {
      expect(doc.querySelectorAll(`section.idea#${id.replace("-", "\\-")}`).length).toBe(1);
      expect(doc.querySelector(`#page-${id} > section.idea`)!.id).toBe(id);
    }
  });

  it("every page starts hidden and the parent field is editable on the card", () => {
    for (const p of doc.querySelectorAll("section.page")) expect(p.hasAttribute("hidden")).toBe(true);
    expect(doc.querySelector('#I-001 [data-field="parent"]')!.getAttribute("data-idea")).toBe("I-001");
  });

  it("the home diagram draws only the top level; the embedded model keeps the written order", () => {
    const pre = doc.querySelector("pre.mermaid")!.textContent!;
    expect(pre).toContain("第一大步");
    expect(pre).not.toContain("地基");
    const start = html.indexOf('id="graph-data"');
    const json = html.slice(html.indexOf(">", start) + 1, html.indexOf("</script>", start));
    expect([...json.matchAll(/"id":\s*"(I-\d+)"/g)].map((m) => m[1]).slice(0, 3)).toEqual(["I-003", "I-002", "I-001"]);
  });
});
