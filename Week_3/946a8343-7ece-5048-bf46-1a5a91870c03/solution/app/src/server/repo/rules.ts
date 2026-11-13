// Push rules: the first violation in the published order. Pure: callers supply what changed.
import { matchesGlob } from "../../shared/glob.ts";

export interface PushRules {
  readonly branch_name: string | null;
  readonly commit_message: string | null;
  readonly forbidden_files: readonly string[];
  readonly required_files: readonly string[];
  readonly secrets: boolean;
}

interface AddedLine {
  readonly line: number;
  readonly text: string;
}

export interface AddedLines {
  readonly path: string;
  readonly lines: readonly AddedLine[];
}

export interface PushFacts {
  readonly branch: string;
  readonly isNewBranch: boolean;
  readonly message: string;
  // Paths added or changed, sorted.
  readonly changed: readonly string[];
  // Every path of the resulting tree.
  readonly result: ReadonlySet<string>;
  // Lines added against the first parent, sorted by path then line. Only asked for when the secrets rule is on.
  readonly added: () => Promise<readonly AddedLines[]>;
}

// `field` names the request field the violation belongs to, for the 422 details.
interface Violation {
  readonly field: "branch" | "message" | "actions";
  readonly message: string;
}

const SECRET_PATTERNS: ReadonlyArray<{ readonly name: string; readonly pattern: RegExp }> = [
  { name: "cloud-key", pattern: /AK[A-Z0-9]{18}/ },
  { name: "private-key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "spur-token", pattern: /sptk_[A-Za-z0-9]{20}/ },
  { name: "password-line", pattern: /password\s*=\s*"[^"]{8,}"/i },
];

// An invalid regular expression matches nothing.
export function matchesPattern(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern).test(text);
  } catch {
    return false;
  }
}

function hasWildcard(pattern: string): boolean {
  return pattern.includes("*") || pattern.includes("?");
}

export function requiredFilePresent(pattern: string, paths: ReadonlySet<string>): boolean {
  if (!hasWildcard(pattern)) return paths.has(pattern.startsWith("/") ? pattern.slice(1) : pattern);
  for (const path of paths) if (matchesGlob(pattern, path)) return true;
  return false;
}

export async function firstViolation(rules: PushRules, facts: PushFacts): Promise<Violation | null> {
  if (facts.isNewBranch && rules.branch_name !== null && !matchesPattern(rules.branch_name, facts.branch)) {
    return { field: "branch", message: `Branch name ${facts.branch} doesn't match ${rules.branch_name}.` };
  }
  if (rules.commit_message !== null && !matchesPattern(rules.commit_message, facts.message)) {
    return { field: "message", message: `Commit message doesn't match ${rules.commit_message}.` };
  }
  for (const path of facts.changed) {
    const glob = rules.forbidden_files.find((candidate) => matchesGlob(candidate, path));
    if (glob !== undefined) return { field: "actions", message: `File ${path} is forbidden by push rule ${glob}.` };
  }
  for (const required of rules.required_files) {
    if (!requiredFilePresent(required, facts.result)) return { field: "actions", message: `Required file ${required} is missing.` };
  }
  if (rules.secrets) {
    for (const file of await facts.added()) {
      for (const { line, text } of file.lines) {
        const secret = SECRET_PATTERNS.find((candidate) => candidate.pattern.test(text));
        if (secret !== undefined) return { field: "actions", message: `Secret found: ${secret.name} in ${file.path} at line ${line}.` };
      }
    }
  }
  return null;
}
