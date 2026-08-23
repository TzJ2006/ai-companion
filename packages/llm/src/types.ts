export interface ClaudeCallOptions {
  model?: string;
  timeout?: number;
  cwd?: string;
  maxOutputBytes?: number;
}

export interface ClaudeCallResult {
  output: string;
  truncated: boolean;
}

export interface PreflightResult {
  available: boolean;
  version?: string;
  error?: string;
}

export class ClaudeNotAvailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeNotAvailableError";
  }
}

export class ClaudeTimeoutError extends Error {
  constructor() {
    super("Claude process timed out");
    this.name = "ClaudeTimeoutError";
  }
}
