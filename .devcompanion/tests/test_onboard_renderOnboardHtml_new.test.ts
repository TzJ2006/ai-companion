import { describe, it, expect } from "vitest";
import { renderOnboardHtml } from "../../packages/render/src/onboard/index.js";
import type { ProjectIndex } from "@aidev/types";
import type { ParsedModule } from "@aidev/ast";

describe("renderOnboardHtml (split module)", () => {
  const mockIndex: ProjectIndex = {
    project_root: "/test",
    last_updated: "2026-01-01T00:00:00Z",
    total_sessions: 1,
    total_changes: 5,
    function_index: {
      abc123: {
        hash: "abc123",
        file_path: "src/main.ts",
        function_name: "main",
        class_name: null,
        last_modified: "2026-01-01T00:00:00Z",
        change_count: 1,
        test_status: "pass",
      },
    },
  };

  const mockModule: ParsedModule = {
    file_path: "src/main.ts",
    functions: [
      {
        name: "main",
        params: [],
        return_type: "void",
        decorators: [],
        is_method: false,
        is_async: true,
        class_name: null,
        start_line: 1,
        end_line: 10,
        docstring: "Entry point",
      },
    ],
    classes: [],
    imports: [],
  };

  it("should return valid HTML document", () => {
    const html = renderOnboardHtml(mockIndex, {
      project_root: "/test",
      modules: [mockModule],
    });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
  });

  it("should include function name in output", () => {
    const html = renderOnboardHtml(mockIndex, {
      project_root: "/test",
      modules: [mockModule],
    });
    expect(html).toContain("main");
  });

  it("should include overview stats", () => {
    const html = renderOnboardHtml(mockIndex, {
      project_root: "/test",
      modules: [mockModule],
    });
    expect(html).toContain("Source Files");
    expect(html).toContain("Functions");
  });

  it("should include custom title", () => {
    const html = renderOnboardHtml(mockIndex, {
      title: "My Custom Report",
      project_root: "/test",
      modules: [mockModule],
    });
    expect(html).toContain("My Custom Report");
  });

  it("should include function index in sidebar", () => {
    const html = renderOnboardHtml(mockIndex, {
      project_root: "/test",
      modules: [mockModule],
    });
    expect(html).toContain("Function Index");
    expect(html).toContain("abc123");
  });

  it("should render async badge", () => {
    const html = renderOnboardHtml(mockIndex, {
      project_root: "/test",
      modules: [mockModule],
    });
    expect(html).toContain("async");
  });

  it("should render docstring", () => {
    const html = renderOnboardHtml(mockIndex, {
      project_root: "/test",
      modules: [mockModule],
    });
    expect(html).toContain("Entry point");
  });
});
