export type IdeaStatus = "draft" | "researching" | "researched" | "failed" | "archived";

export interface IdeaEntry {
  slug: string;
  title: string;
  description: string;
  status: IdeaStatus;
  tags: string[];
  created: string;
  updated: string;
  failure_reason?: string;
}

export interface IdeaIndexEntry {
  slug: string;
  title: string;
  status: IdeaStatus;
  tags: string[];
  created: string;
  updated: string;
  research_size_bytes?: number;
}

export interface IdeaFilter {
  status?: IdeaStatus;
  tag?: string;
}

export interface ResearchOptions {
  model?: string;
  timeout?: number;
  projectRoot?: string;
}

export interface ValidationResult {
  valid: boolean;
  missing_sections: string[];
  empty_sections: string[];
}

export const REQUIRED_SECTIONS = [
  "Summary",
  "Prior Art",
  "Comparison",
  "Technical Feasibility",
  "Implementation Approaches",
  "Risks",
  "Recommended Next Steps",
] as const;
