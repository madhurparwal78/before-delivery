// `rules` lists: reading, and picking the first rule that matches.
import { matchesGlob } from "../../../shared/glob.ts";
import { evaluateIf } from "./expr.ts";
import { oneOf, readBool, readDuration, readText, readVariables } from "./fields.ts";
import { asMap, entryOf, textsOf } from "./nodes.ts";
import { messages, type Problems } from "./problems.ts";
import type { JobWhen } from "./types.ts";
import type { YamlNode } from "./yaml.ts";

export const JOB_WHENS: readonly JobWhen[] = ["on_success", "on_failure", "always", "manual", "delayed"];
const RULE_WHENS = [...JOB_WHENS, "never"] as const;
const RULE_KEYS = ["if", "changes", "exists", "when", "allow_failure", "variables", "start_in"];

export interface Rule {
  readonly condition: string | null;
  readonly changes: string[] | null;
  readonly exists: string[] | null;
  readonly when: JobWhen | "never" | null;
  readonly allowFailure: boolean | null;
  readonly variables: Record<string, string>;
  readonly startInMs: number | null;
}

interface RuleContext {
  readonly vars: Readonly<Record<string, string>>;
  readonly changedFiles: readonly string[] | null;
  readonly treeFiles: readonly string[];
}

// Returns null when the key is absent, so "no rules" and "an empty rules list" stay different.
export function readRules(node: YamlNode | undefined, problems: Problems): Rule[] | null {
  if (node?.kind !== "list") return null;
  const rules: Rule[] = [];
  for (const item of node.items) {
    const map = asMap(item);
    if (!map) continue;
    for (const entry of map.entries) {
      if (!RULE_KEYS.includes(entry.key)) problems.add(entry.line, messages.unknownKeyword(entry.key));
    }
    const changes = entryOf(map, "changes");
    const exists = entryOf(map, "exists");
    rules.push({
      condition: readText(map, "if"),
      changes: changes ? textsOf(changes.value) : null,
      exists: exists ? textsOf(exists.value) : null,
      when: oneOf(readText(map, "when"), RULE_WHENS),
      allowFailure: readBool(map, "allow_failure"),
      variables: readVariables(entryOf(map, "variables")?.value),
      startInMs: readDuration(map, "start_in", problems, false),
    });
  }
  return rules;
}

function matches(rule: Rule, context: RuleContext): boolean {
  if (rule.condition !== null && !evaluateIf(rule.condition, context.vars)) return false;
  if (rule.changes !== null && context.changedFiles !== null) {
    const files = context.changedFiles;
    if (!files.some((file) => rule.changes?.some((glob) => matchesGlob(glob, file)))) return false;
  }
  if (rule.exists !== null) {
    if (!context.treeFiles.some((file) => rule.exists?.some((glob) => matchesGlob(glob, file)))) return false;
  }
  return true;
}

export function firstMatchingRule(rules: readonly Rule[], context: RuleContext): Rule | null {
  return rules.find((rule) => matches(rule, context)) ?? null;
}
