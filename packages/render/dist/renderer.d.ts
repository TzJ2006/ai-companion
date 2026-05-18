import type { ReviewSession } from "@aidev/history";
export interface RenderOptions {
    title?: string;
    show_test_status: boolean;
    show_error_ids: boolean;
    style: "side-by-side" | "line-by-line";
}
export declare function renderSessionToHtml(session: ReviewSession, _rawDiffs: string[], options?: RenderOptions): string;
export declare function escapeHtml(text: string): string;
//# sourceMappingURL=renderer.d.ts.map