/**
 * Access evaluation: the baseline grants first, then table, row and field rules
 * in that order. Any matching rule denies, and rules never apply to the
 * operator. This is the one place a denial is decided.
 */

import { ApiError } from '../errors';
import { fieldLabel, requesterReadableFields, tableLabels, type TableName } from './fields';
import type { RoleKey } from './roles';

export type AccessRuleType = 'table' | 'row' | 'field';
export type Operation = 'read' | 'write';

export interface AccessRule {
  readonly name: string;
  readonly type: AccessRuleType;
  readonly table: string;
  readonly field: string | null;
  readonly operation: Operation;
  readonly roles: readonly RoleKey[];
  readonly condition: string | null;
  readonly active: boolean;
}

/** What a record must expose for access to be decided on it. */
export interface AccessRecord {
  readonly table: TableName;
  readonly number: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface Viewer {
  readonly username: string;
  readonly roles: readonly RoleKey[];
  readonly department: string | null;
}

export interface AccessContext {
  readonly viewer: Viewer;
  readonly rules: readonly AccessRule[];
  /** Usernames of the people in the viewer's department. */
  readonly departmentMembers: readonly string[];
  /** Evaluates a row rule's condition against a record. */
  readonly matches: (condition: string, record: AccessRecord) => boolean;
}

export function isOperator(viewer: Viewer): boolean {
  return viewer.roles.includes('operator');
}

function has(viewer: Viewer, role: RoleKey): boolean {
  return viewer.roles.includes(role);
}

/** Baseline read of a whole table. */
export function baselineReadsTable(viewer: Viewer, table: TableName): boolean {
  if (isOperator(viewer)) return true;
  if (has(viewer, 'technician')) return true;
  if (has(viewer, 'manager')) return true;
  if (has(viewer, 'approver')) return true;
  if (has(viewer, 'requester')) {
    return table === 'incident' || table === 'request_item' || table === 'task';
  }
  return false;
}

/** Baseline write of a whole table. */
export function baselineWritesTable(viewer: Viewer, table: TableName): boolean {
  if (isOperator(viewer)) return true;
  if (has(viewer, 'technician')) {
    return table === 'incident' || table === 'problem' || table === 'task' || table === 'request_item';
  }
  return false;
}

/** Baseline visibility of one record. */
export function baselineSeesRecord(context: AccessContext, record: AccessRecord): boolean {
  const { viewer } = context;
  if (isOperator(viewer) || has(viewer, 'technician')) return true;
  const fields = record.fields;
  const mine =
    fields.caller === viewer.username ||
    fields.requested_for === viewer.username ||
    fields.requester === viewer.username;
  if (has(viewer, 'manager')) {
    const caller = fields.caller;
    if (typeof caller === 'string' && context.departmentMembers.includes(caller)) return true;
    if (mine) return true;
  }
  if (has(viewer, 'approver') && record.table === 'change') return true;
  if (has(viewer, 'requester') || has(viewer, 'approver')) {
    if (record.table === 'incident' || record.table === 'request_item') return mine;
  }
  return false;
}

/** Baseline readable fields of one table. */
export function baselineReadsField(viewer: Viewer, table: TableName, field: string): boolean {
  if (isOperator(viewer) || has(viewer, 'technician') || has(viewer, 'manager')) return true;
  if (has(viewer, 'approver') && table === 'change') return true;
  return requesterReadableFields.includes(field);
}

export function baselineWritesField(viewer: Viewer, table: TableName, field: string): boolean {
  return baselineWritesTable(viewer, table);
}

function ruleApplies(rule: AccessRule, viewer: Viewer, operation: Operation, table: string): boolean {
  if (!rule.active) return false;
  if (isOperator(viewer)) return false;
  if (rule.operation !== operation) return false;
  if (rule.table !== table) return false;
  return rule.roles.some((role) => viewer.roles.includes(role));
}

export function tableDenied(context: AccessContext, table: TableName, operation: Operation): boolean {
  return context.rules.some((r) => r.type === 'table' && ruleApplies(r, context.viewer, operation, table));
}

export function rowDenied(
  context: AccessContext,
  record: AccessRecord,
  operation: Operation,
): boolean {
  return context.rules.some(
    (r) =>
      r.type === 'row' &&
      ruleApplies(r, context.viewer, operation, record.table) &&
      (r.condition === null || context.matches(r.condition, record)),
  );
}

export function fieldDenied(
  context: AccessContext,
  record: AccessRecord | null,
  table: TableName,
  field: string,
  operation: Operation,
): boolean {
  return context.rules.some(
    (r) =>
      r.type === 'field' &&
      r.field === field &&
      ruleApplies(r, context.viewer, operation, table) &&
      (r.condition === null || record === null || context.matches(r.condition, record)),
  );
}

/** A record the caller may not see answers 404 on every endpoint. */
export function canSeeRecord(context: AccessContext, record: AccessRecord): boolean {
  if (!baselineReadsTable(context.viewer, record.table)) return false;
  if (tableDenied(context, record.table, 'read')) return false;
  if (!baselineSeesRecord(context, record)) return false;
  if (rowDenied(context, record, 'read')) return false;
  return true;
}

export function canWriteRecord(context: AccessContext, record: AccessRecord): boolean {
  if (!baselineWritesTable(context.viewer, record.table)) return false;
  if (tableDenied(context, record.table, 'write')) return false;
  if (rowDenied(context, record, 'write')) return false;
  return true;
}

export function canReadField(
  context: AccessContext,
  record: AccessRecord | null,
  table: TableName,
  field: string,
): boolean {
  if (!baselineReadsField(context.viewer, table, field)) return false;
  return !fieldDenied(context, record, table, field, 'read');
}

export function canWriteField(
  context: AccessContext,
  record: AccessRecord | null,
  table: TableName,
  field: string,
): boolean {
  if (!baselineWritesField(context.viewer, table, field)) return false;
  if (fieldDenied(context, record, table, field, 'write')) return false;
  return !fieldDenied(context, record, table, field, 'read');
}

/** The fields of a table this viewer may read, in table order. */
export function readableFields(
  context: AccessContext,
  record: AccessRecord | null,
  table: TableName,
  all: readonly string[],
): string[] {
  return all.filter((field) => canReadField(context, record, table, field));
}

export const deniedFieldWrite = (table: TableName, field: string): ApiError =>
  new ApiError(403, 'field_denied', `You cannot change ${fieldLabel(table, field)}.`);

export const deniedTableWrite = (table: TableName): ApiError =>
  new ApiError(403, 'denied', `You cannot change ${tableLabels[table]} records.`);
