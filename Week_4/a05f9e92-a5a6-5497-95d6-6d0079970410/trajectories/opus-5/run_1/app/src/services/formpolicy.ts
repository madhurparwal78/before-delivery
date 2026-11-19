/**
 * Form policies. The browser and the server apply the very same policies, in
 * ascending order, with a later action on the same field and property winning.
 */

import { condition as evaluateCondition, type Scope } from '../expr/interpret';
import { fieldLabel, type TableName } from '../domain/fields';
import { ApiError } from '../errors';
import type { FormPolicyRow } from './store';

export interface FieldState {
  mandatory: boolean;
  visible: boolean;
  read_only: boolean;
}

export type PolicyOutcome = Record<string, FieldState>;

export interface PolicyTarget {
  readonly table?: TableName;
  readonly catalogItem?: string;
}

function applies(policy: FormPolicyRow, target: PolicyTarget): boolean {
  if (target.catalogItem !== undefined) return policy.catalogItem === target.catalogItem;
  return policy.table === target.table;
}

/** The resolved mandatory, visible and read-only state of each named field. */
export function resolvePolicies(
  policies: readonly FormPolicyRow[],
  target: PolicyTarget,
  scope: Scope,
  fields: readonly string[],
): PolicyOutcome {
  const outcome: PolicyOutcome = {};
  for (const field of fields) {
    outcome[field] = { mandatory: false, visible: true, read_only: false };
  }
  const ordered = policies
    .filter((p) => applies(p, target))
    .sort((a, b) => a.order - b.order || (a.name < b.name ? -1 : 1));
  for (const policy of ordered) {
    let matched = false;
    try {
      matched = evaluateCondition(policy.condition, scope);
    } catch {
      matched = false;
    }
    if (!matched) continue;
    for (const action of policy.actions) {
      const state = outcome[action.field] ?? { mandatory: false, visible: true, read_only: false };
      if (action.mandatory !== null && action.mandatory !== undefined) state.mandatory = action.mandatory;
      if (action.visible !== null && action.visible !== undefined) state.visible = action.visible;
      if (action.read_only !== null && action.read_only !== undefined) state.read_only = action.read_only;
      outcome[action.field] = state;
    }
  }
  return outcome;
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export interface PolicyEnforcement {
  /** Field errors, keyed by field, in the order the fields were given. */
  readonly errors: Record<string, string>;
  /** Values after hidden fields were discarded. */
  readonly values: Record<string, unknown>;
}

/**
 * The server applies the same policies to the submitted values: a mandatory
 * empty field and a changed read-only field are refused, and a hidden field's
 * value is discarded.
 */
export function enforcePolicies(
  outcome: PolicyOutcome,
  submitted: Readonly<Record<string, unknown>>,
  stored: Readonly<Record<string, unknown>>,
  labelFor: (field: string) => string,
): PolicyEnforcement {
  const errors: Record<string, string> = {};
  const values: Record<string, unknown> = { ...submitted };
  for (const [field, state] of Object.entries(outcome)) {
    if (!state.visible) {
      delete values[field];
      continue;
    }
    if (state.read_only && field in submitted) {
      const before = stored[field] ?? null;
      const after = submitted[field] ?? null;
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        errors[field] = `${labelFor(field)} is read-only.`;
        continue;
      }
    }
    if (state.mandatory) {
      const value = field in values ? values[field] : stored[field];
      if (isEmpty(value)) errors[field] = `${labelFor(field)} is required.`;
    }
  }
  return { errors, values };
}

export function fieldErrors(errors: Record<string, string>): ApiError {
  const count = Object.keys(errors).length;
  return new ApiError(
    422,
    'validation',
    `${count} ${count === 1 ? 'problem' : 'problems'} to fix before saving.`,
    errors,
  );
}

export function tableLabelFor(table: TableName): (field: string) => string {
  return (field) => fieldLabel(table, field);
}
