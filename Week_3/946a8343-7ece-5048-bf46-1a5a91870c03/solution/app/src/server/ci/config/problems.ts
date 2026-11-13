// Lint messages: collected, de-duplicated, sorted by line then text and capped.
const MAX_MESSAGES = 20;

interface Problem {
  readonly line: number;
  readonly text: string;
}

export function formatProblem(line: number, text: string): string {
  return `Line ${line}: ${text}.`;
}

export const UNREADABLE_LINE = "can't read this line";

export const messages = {
  unknownKeyword: (key: string) => `unknown keyword "${key}"`,
  unknownStage: (job: string, stage: string) => `job "${job}" uses stage "${stage}", which isn't in stages`,
  needsMissing: (job: string, need: string) => `job "${job}" needs "${need}", which doesn't exist`,
  needsRemoved: (job: string, need: string) => `job "${job}" needs "${need}", which rules removed`,
  needsLater: (job: string, need: string) => `job "${job}" needs "${need}", in a later stage`,
  needsCycle: (path: readonly string[]) => `needs cycle: ${path.join(" -> ")}`,
  extendsCycle: (path: readonly string[]) => `extends cycle: ${path.join(" -> ")}`,
  extendsUnknown: (job: string, name: string) => `job "${job}" extends unknown "${name}"`,
  includeMissing: (path: string) => `include "${path}" not found`,
  includeCycle: (path: readonly string[]) => `include cycle: ${path.join(" -> ")}`,
  retryTooHigh: (max: number) => `retry max can't exceed ${max}`,
  noScript: (job: string) => `job "${job}" has no script`,
  badDuration: (text: string) => `can't read duration "${text}"`,
};

export class Problems {
  private readonly found = new Map<string, Problem>();
  private unreadableMessage: string | null = null;

  add(line: number, text: string): void {
    this.found.set(`${line}:${text}`, { line, text });
  }

  // An unreadable line ends all reading and is the only message returned.
  markUnreadable(line: number): void {
    this.unreadableMessage ??= formatProblem(line, UNREADABLE_LINE);
  }

  get unreadable(): boolean {
    return this.unreadableMessage !== null;
  }

  get any(): boolean {
    return this.unreadable || this.found.size > 0;
  }

  lines(): string[] {
    if (this.unreadableMessage !== null) return [this.unreadableMessage];
    return [...this.found.values()]
      .sort((a, b) => a.line - b.line || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0))
      .slice(0, MAX_MESSAGES)
      .map((problem) => formatProblem(problem.line, problem.text));
  }
}
