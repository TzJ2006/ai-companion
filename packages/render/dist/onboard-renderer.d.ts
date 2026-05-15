import type { ProjectIndex } from "@aidev/history";
import type { ParsedModule } from "@aidev/ast";
export interface OnboardRenderOptions {
    title?: string;
    project_root: string;
    modules: ParsedModule[];
}
export declare function renderOnboardHtml(index: ProjectIndex, options: OnboardRenderOptions): string;
//# sourceMappingURL=onboard-renderer.d.ts.map