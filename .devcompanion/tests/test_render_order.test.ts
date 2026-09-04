import { describe, it, expect } from "vitest";
import { parseDocument } from "yaml";
import { render, topoOrder, type Graph } from "../../companion/ideas.js";

// I-061 — the detail cards under the diagram come out in dependency order
// (topoOrder, I-060), not in the order somebody happened to write them in.
// The yaml, the ids, the embedded JSON model and the diagram all stay put:
// only what a reader sees changes.
describe("render: detail cards in dependency order (I-061)", () => {
  // Written deliberately backwards: the endpoint first, the foundation last.
  const backwards = `version: 1
project: fixture
endpoints: [I-003]
ideas:
  - id: I-003
    name: "终点"
    status: todo
    needs: [I-002]
  - id: I-002
    name: "中间"
    status: todo
    needs: [I-001]
  - id: I-001
    name: "地基"
    status: done
    needs: []
`;
  const forwards = `version: 1
project: fixture
endpoints: [I-003]
ideas:
  - id: I-001
    name: "地基"
    status: done
    needs: []
  - id: I-003
    name: "终点"
    status: todo
    needs: [I-002]
  - id: I-002
    name: "中间"
    status: todo
    needs: [I-001]
`;
  const graphOf = (text: string) => parseDocument(text).toJSON() as Graph;

  const cardOrder = (html: string) => {
    const cards = html.slice(html.indexOf('<div id="cards">'));
    return [...cards.matchAll(/<section class="idea[^"]*" id="(I-\d+)"/g)].map((m) => m[1]);
  };
  const modelOrder = (html: string) => {
    const start = html.indexOf('id="graph-data"');
    const json = html.slice(html.indexOf(">", start) + 1, html.indexOf("</script>", start));
    return [...json.matchAll(/"id":\s*"(I-\d+)"/g)].map((m) => m[1]);
  };

  it("every card sits after all of its prerequisites, whatever order the yaml lists them in", () => {
    const html = render(graphOf(backwards), backwards);
    expect(cardOrder(html)).toEqual(["I-001", "I-002", "I-003"]);
    expect(cardOrder(html)).toEqual(topoOrder(graphOf(backwards)).map((i) => i.id));
  });

  it("shuffling the written order leaves the card order alone", () => {
    expect(cardOrder(render(graphOf(forwards), forwards)))
      .toEqual(cardOrder(render(graphOf(backwards), backwards)));
  });

  it("the embedded JSON model keeps the written order — only the view is sorted", () => {
    expect(modelOrder(render(graphOf(backwards), backwards))).toEqual(["I-003", "I-002", "I-001"]);
  });

  it("anchors are found by id, so a sorted card is still reachable from the diagram", () => {
    const html = render(graphOf(backwards), backwards);
    for (const id of ["I-001", "I-002", "I-003"]) {
      expect(html).toMatch(new RegExp(`<section class="idea[^"]*" id="${id}"`));
    }
  });

  it("tells the reader the cards are in dependency order, not file order", () => {
    const html = render(graphOf(backwards), backwards);
    const heading = html.indexOf("想法详情");
    expect(heading).toBeGreaterThan(0);
    expect(html.slice(heading, heading + 400)).toMatch(/依赖顺序/);
  });
});
