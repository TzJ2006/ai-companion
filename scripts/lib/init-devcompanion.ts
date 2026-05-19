import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface InitResult {
  created_directories: string[];
  already_existed: boolean;
}

const REQUIRED_DIRECTORIES = [
  ".devcompanion",
  ".devcompanion/reports",
  ".devcompanion/reports/archive",
  ".devcompanion/confirmations",
  ".devcompanion/confirmations/archive",
];

export function initDevcompanion(projectPath: string): InitResult {
  const created: string[] = [];
  const devcompanionPath = join(projectPath, ".devcompanion");
  const alreadyExisted = existsSync(devcompanionPath);

  for (const relativeDirectory of REQUIRED_DIRECTORIES) {
    const fullPath = join(projectPath, relativeDirectory);
    if (!existsSync(fullPath)) {
      mkdirSync(fullPath, { recursive: true });
      created.push(relativeDirectory);
    }
  }

  const docsEclPath = join(projectPath, "docs", "ecl");
  if (!existsSync(docsEclPath)) {
    mkdirSync(docsEclPath, { recursive: true });
    created.push("docs/ecl");
  }

  return {
    created_directories: created,
    already_existed: alreadyExisted,
  };
}
