/**
 * Business rules. Before rules, then the save, then after rules in the same
 * transaction, then background rules after commit. Within each timing, rules run
 * by ascending order then name in code-point order.
 */

import { settings } from '../config';
import { ApiError } from '../errors';
import { condition as evaluateCondition, evaluateText, type Scope } from '../expr/interpret';
import { valueToText, type Value } from '../expr/value';
import type { TableName } from '../domain/fields';
import type { RuleTiming } from './store';
import type { BusinessRuleRow, RecordFields } from './store';

export type RuleOperation = 'insert' | 'update';

export interface SetAction {
  readonly set: Readonly<Record<string, string>>;
}
export interface AbortAction {
  readonly abort: string;
}
export interface WorkNoteAction {
  readonly work_note: string;
}
export interface InboxAction {
  readonly inbox: {
    readonly to: { readonly users?: readonly string[]; readonly roles?: readonly string[] };
    readonly text: string;
  };
}
export interface UpdateRecordAction {
  readonly update_record: {
    readonly path: string;
    readonly fields: Readonly<Record<string, string>>;
  };
}

export type RuleAction = SetAction | AbortAction | WorkNoteAction | InboxAction | UpdateRecordAction;

export class RuleAbort extends ApiError {
  constructor(message: string) {
    super(422, 'aborted', message);
  }
}

export class RuleDepthExceeded extends ApiError {
  constructor(limit: number, ruleName: string) {
    super(422, 'rule_depth', `Business rules stopped after ${limit} nested updates at rule "${ruleName}".`);
  }
}

/** Active rules for a table and timing, in the published run order. */
export function rulesFor(
  rules: readonly BusinessRuleRow[],
  table: TableName,
  timing: RuleTiming,
  operation: RuleOperation,
): BusinessRuleRow[] {
  return rules
    .filter(
      (r) =>
        r.active && r.table === table && r.when === timing && r.operations.includes(operation),
    )
    .sort((a, b) => a.order - b.order || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export interface RuleEffects {
  /** Fields a `set` action wrote, applied to the record being saved. */
  readonly sets: Record<string, Value>;
  readonly workNotes: string[];
  readonly inboxes: {
    readonly users: readonly string[];
    readonly roles: readonly string[];
    readonly text: string;
  }[];
  readonly nested: {
    readonly path: string;
    readonly fields: Readonly<Record<string, string>>;
    readonly ruleName: string;
  }[];
}

export function emptyEffects(): RuleEffects {
  return { sets: {}, workNotes: [], inboxes: [], nested: [] };
}

export interface RuleRunResult {
  readonly effects: RuleEffects;
  /** Rules whose conditions matched, for activity lines on failure. */
  readonly ran: readonly string[];
}

/**
 * Runs one timing's rules. `scopeFor` rebuilds the scope after each `set` so a
 * later rule sees what an earlier one wrote.
 */
export function runRules(
  rules: readonly BusinessRuleRow[],
  table: TableName,
  timing: RuleTiming,
  operation: RuleOperation,
  fields: RecordFields,
  scopeFor: (fields: RecordFields) => Scope,
): RuleRunResult {
  const effects = emptyEffects();
  const ran: string[] = [];
  const working: RecordFields = { ...fields };
  for (const rule of rulesFor(rules, table, timing, operation)) {
    const scope = scopeFor(working);
    if (!evaluateCondition(rule.condition, scope)) continue;
    ran.push(rule.name);
    for (const action of rule.actions as readonly unknown[] as readonly RuleAction[]) {
      if ('abort' in action) {
        if (timing !== 'before') {
          throw new ApiError(422, 'validation', 'Only before rules can abort.');
        }
        throw new RuleAbort(action.abort);
      }
      if ('set' in action) {
        for (const [field, expression] of Object.entries(action.set)) {
          const value = evaluateText(expression, scopeFor(working));
          effects.sets[field] = value;
          working[field] = toFieldValue(value);
        }
        continue;
      }
      if ('work_note' in action) {
        effects.workNotes.push(action.work_note);
        continue;
      }
      if ('inbox' in action) {
        effects.inboxes.push({
          users: action.inbox.to.users ?? [],
          roles: action.inbox.to.roles ?? [],
          text: action.inbox.text,
        });
        continue;
      }
      effects.nested.push({
        path: action.update_record.path,
        fields: action.update_record.fields,
        ruleName: rule.name,
      });
    }
  }
  return { effects, ran };
}

function toFieldValue(value: Value): RecordFields[string] {
  if (value === null) return null;
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return value;
  if (Array.isArray(value)) return [...value] as unknown[];
  return valueToText(value);
}

export function depthLimit(): number {
  return settings().BUSINESS_RULE_DEPTH_LIMIT;
}

export function backgroundFailureLine(ruleName: string, message: string): string {
  return `Background rule "${ruleName}" failed: ${message}.`;
}

/** Only before rules may abort; a rule save is refused otherwise. */
export function validateRuleActions(timing: RuleTiming, actions: readonly RuleAction[]): void {
  if (timing === 'before') return;
  if (actions.some((a) => 'abort' in a)) {
    throw new ApiError(422, 'validation', 'Only before rules can abort.');
  }
}
