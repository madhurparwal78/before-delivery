// The record engine: save, transition, priority, assignment, business rules.
// One place decides every record lifecycle rule.

import { Db, clock } from './db.js';
import { ApiError, fieldDenied, unknownField } from './errors.js';
import { Role, Table, TRANSITIONS, STATE_LABELS, compute_priority, TABLE_LABEL, PREFIXES, pad_number } from '../shared/model.js';
import { Ctx as ExprCtx, parse, evaluate, truthy } from '../express/expression.js';

export interface RecordSnapshot {
  number: string;
  table: Table;
  state: string;
  workspace: 'live' | 'test';
  fields: Record<string, unknown>;
  priority_overridden: boolean;
  created_at: number;
  created_by: string | null;
}

export interface FieldSpecMeta {
  name: string;
  label: string;
  type: 'text' | 'number' | 'bool' | 'select' | 'time' | 'ref' | 'json';
  refTable?: string;
  choices?: string[];
  readOnly?: boolean;
}

/** Field metadata per table: labels and value kinds. */
export const FIELD_SPECS: Record<Table, FieldSpecMeta[]> = {
  incident: [
    { name: 'short_description', label: 'Short description', type: 'text' },
    { name: 'description', label: 'Description', type: 'text' },
    { name: 'caller', label: 'Caller', type: 'ref' },
    { name: 'affected_person', label: 'Affected person', type: 'ref' },
    { name: 'configuration_item', label: 'Service or item', type: 'ref' },
    { name: 'impact', label: 'Impact', type: 'number' },
    { name: 'urgency', label: 'Urgency', type: 'number' },
    { name: 'priority', label: 'Priority', type: 'number', readOnly: true },
    { name: 'assignment_group', label: 'Assignment group', type: 'ref' },
    { name: 'assigned_to', label: 'Assigned to', type: 'ref' },
    { name: 'hold_reason', label: 'Hold reason', type: 'select', choices: ['awaiting_requester', 'awaiting_supplier', 'awaiting_change'] },
    { name: 'resolution_code', label: 'Resolution code', type: 'select', choices: ['fixed', 'workaround_given', 'no_fault_found', 'duplicate'] },
    { name: 'resolution_note', label: 'Resolution note', type: 'text' },
    { name: 'reopen_reason', label: 'Reopen reason', type: 'text' },
    { name: 'cancel_reason', label: 'Cancel reason', type: 'text' },
    { name: 'confidential', label: 'Confidential', type: 'bool' },
    { name: 'is_major', label: 'Major incident', type: 'bool' },
    { name: 'parent', label: 'Parent', type: 'ref' },
    { name: 'problem', label: 'Problem', type: 'ref' },
    { name: 'sla_breached', label: 'SLA breached', type: 'bool', readOnly: true },
    { name: 'created_at', label: 'Created', type: 'time', readOnly: true },
    { name: 'resolved_at', label: 'Resolved', type: 'time', readOnly: true },
  ],
  problem: [
    { name: 'short_description', label: 'Short description', type: 'text' },
    { name: 'description', label: 'Description', type: 'text' },
    { name: 'configuration_item', label: 'Service or item', type: 'ref' },
    { name: 'impact', label: 'Impact', type: 'number' },
    { name: 'urgency', label: 'Urgency', type: 'number' },
    { name: 'priority', label: 'Priority', type: 'number', readOnly: true },
    { name: 'assignment_group', label: 'Assignment group', type: 'ref' },
    { name: 'assigned_to', label: 'Assigned to', type: 'ref' },
    { name: 'workaround', label: 'Workaround', type: 'text' },
    { name: 'fix_change', label: 'Fix change', type: 'ref' },
    { name: 'cancel_reason', label: 'Cancel reason', type: 'text' },
    { name: 'created_at', label: 'Created', type: 'time', readOnly: true },
    { name: 'resolved_at', label: 'Resolved', type: 'time', readOnly: true },
  ],
  change: [
    { name: 'title', label: 'Title', type: 'text' },
    { name: 'model', label: 'Model', type: 'select', choices: ['normal', 'standard', 'emergency'] },
    { name: 'configuration_item', label: 'Service or item', type: 'ref' },
    { name: 'planned_start', label: 'Planned start', type: 'time' },
    { name: 'planned_end', label: 'Planned end', type: 'time' },
    { name: 'implementation_plan', label: 'Implementation plan', type: 'text' },
    { name: 'backout_plan', label: 'Backout plan', type: 'text' },
    { name: 'backout_tested', label: 'Backout tested', type: 'bool' },
    { name: 'standard_template', label: 'Standard template', type: 'text' },
    { name: 'freeze_override_reason', label: 'Freeze override reason', type: 'text' },
    { name: 'outcome', label: 'Outcome', type: 'select', choices: ['successful', 'failed', 'backed_out'] },
    { name: 'close_note', label: 'Close note', type: 'text' },
    { name: 'cancel_reason', label: 'Cancel reason', type: 'text' },
    { name: 'priority', label: 'Priority', type: 'number', readOnly: true },
    { name: 'created_at', label: 'Created', type: 'time', readOnly: true },
  ],
  request_item: [
    { name: 'request', label: 'Request', type: 'ref' },
    { name: 'item', label: 'Catalog item', type: 'ref' },
    { name: 'short_description', label: 'Short description', type: 'text', readOnly: true },
    { name: 'quantity', label: 'Quantity', type: 'number' },
    { name: 'variables', label: 'Variables', type: 'json' },
    { name: 'requested_for', label: 'Requested for', type: 'ref' },
    { name: 'impact', label: 'Impact', type: 'number' },
    { name: 'urgency', label: 'Urgency', type: 'number' },
    { name: 'priority', label: 'Priority', type: 'number', readOnly: true },
    { name: 'assignment_group', label: 'Assignment group', type: 'ref' },
    { name: 'assigned_to', label: 'Assigned to', type: 'ref' },
    { name: 'cancel_reason', label: 'Cancel reason', type: 'text' },
  ],
  task: [
    { name: 'short_description', label: 'Short description', type: 'text' },
    { name: 'description', label: 'Description', type: 'text' },
    { name: 'parent', label: 'Parent', type: 'ref' },
    { name: 'assignment_group', label: 'Assignment group', type: 'ref' },
    { name: 'assigned_to', label: 'Assigned to', type: 'ref' },
    { name: 'close_note', label: 'Close note', type: 'text' },
    { name: 'cancel_reason', label: 'Cancel reason', type: 'text' },
    { name: 'priority', label: 'Priority', type: 'number', readOnly: true },
    { name: 'created_at', label: 'Created', type: 'time', readOnly: true },
  ],
};

export function fieldSpec(table: Table, field: string): FieldSpecMeta | undefined {
  return FIELD_SPECS[table].find(f => f.name === field);
}

export function fieldLabel(table: Table, field: string): string {
  return fieldSpec(table, field)?.label ?? field.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

export function allFieldNames(table: Table): string[] {
  return FIELD_SPECS[table].map(f => f.name);
}

export function stateLabel(state: string): string {
  return STATE_LABELS[state] ?? state;
}

export function typeLabel(table: Table): string {
  return TABLE_LABEL[table].toLowerCase();
}

/** Known paths for expression validation: table fields, plus reference fields
 *  resolved through people, groups and items. */
export function knownPath(table: Table, path: string): boolean {
  const parts = path.split('.');
  const first = parts[0];
  const base = FIELD_SPECS[table].find(f => f.name === first);
  if (!base) return false;
  if (parts.length === 1) return true;

  // Reference fields expose their target's members.
  const refTargets: Record<string, string[]> = {
    caller: ['username', 'display_name', 'department', 'name'],
    affected_person: ['username', 'display_name', 'department', 'name'],
    assigned_to: ['username', 'display_name', 'department', 'name'],
    requested_for: ['username', 'display_name', 'department', 'name'],
    configuration_item: ['name', 'class', 'criticality', 'business_critical', 'status', 'owner_department'],
    assignment_group: ['name'],
    parent: ['number', 'state'],
    problem: ['number', 'state'],
    fix_change: ['number', 'state'],
    request: ['number', 'state'],
    item: ['id', 'name'],
  };
  const target = refTargets[first];
  if (!target) return false;
  return target.includes(parts[1]);
}

/** Number allocation inside a transaction. */
export async function allocateNumber(client: { query: (sql: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }, table: Table): Promise<string> {
  const res = await client.query(
    `INSERT INTO sequences(name, next) VALUES ($1, 2)
     ON CONFLICT (name) DO UPDATE SET next = sequences.next + 1
     RETURNING next - 1 AS n`,
    [table],
  );
  return `${PREFIXES[table]}${pad_number(Number(res.rows[0].n))}`;
}

export async function allocateNamedNumber(client: { query: (sql: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }, kind: 'request' | 'article' | 'set'): Promise<string> {
  const prefix = kind === 'request' ? 'ASK-' : kind === 'article' ? 'ART-' : 'SET-';
  const res = await client.query(
    `INSERT INTO sequences(name, next) VALUES ($1, 2)
     ON CONFLICT (name) DO UPDATE SET next = sequences.next + 1
     RETURNING next - 1 AS n`,
    [kind],
  );
  return `${prefix}${pad_number(Number(res.rows[0].n))}`;
}

/** Load a record snapshot or null. */
export async function loadSnapshot(db: Db, number: string): Promise<RecordSnapshot | null> {
  const res = await db.query(
    `SELECT number, "table", state, workspace, fields, priority_overridden, created_at, created_by
     FROM records WHERE number = $1`,
    [number],
  );
  if (!res.rows.length) return null;
  const row = res.rows[0];
  return {
    number: row.number as string,
    table: row.table as Table,
    state: row.state as string,
    workspace: row.workspace as 'live' | 'test',
    fields: (row.fields ?? {}) as Record<string, unknown>,
    priority_overridden: Boolean(row.priority_overridden),
    created_at: new Date(row.created_at as Date).getTime(),
    created_by: (row.created_by as string | null) ?? null,
  };
}

/** Append state history and return the timestamp used. */
export async function recordState(db: Db | { query: (sql: string, p?: unknown[]) => Promise<unknown> }, number: string, state: string, at: number): Promise<void> {
  await db.query(`INSERT INTO state_history(record, state, at) VALUES ($1, $2, $3)`, [number, state, new Date(at)]);
}

/** Build an expression context for a record. */
export function recordCtx(rec: Record<string, unknown>, viewer: { username: string; roles: string[] }, now: number, previous?: Record<string, unknown>): ExprCtx {
  return {
    rec,
    previous,
    now,
    me: viewer.username,
    roles: new Set(viewer.roles),
    resolve: (path: string) => resolveRecordPath(rec, path),
  };
}

/** Resolve dotted paths against a record snapshot: direct fields, then
 *  reference targets joined in as plain values. */
export function resolveRecordPath(rec: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  if (parts.length === 1) {
    return Object.prototype.hasOwnProperty.call(rec, parts[0]) ? rec[parts[0]] : null;
  }
  const [first, second] = parts;
  if (!Object.prototype.hasOwnProperty.call(rec, first)) return null;
  const value = rec[first];
  if (value === null || value === undefined) return null;
  const refViews: Record<string, Record<string, unknown>> = (rec as Record<string, unknown> & { __refs__?: Record<string, Record<string, unknown>> }).__refs__ ?? {};
  const view = refViews[first];
  if (view && Object.prototype.hasOwnProperty.call(view, second)) return view[second];
  if (second === 'name' || second === 'username') return value;
  if (second === 'display_name') return value;
  return null;
}

/** Transition check: does the published table allow this move for this role? */
export interface TransitionCheck { ok: boolean; error?: { code: string; message: string; fields?: Record<string, string> } }

export function checkTransition(table: Table, from: string, to: string, roles: Role[]): TransitionCheck {
  if (from === to) {
    return { ok: false, error: { code: 'illegal_transition', message: `Cannot move ${typeLabel(table)} from ${stateLabel(from)} to ${stateLabel(to)}.` } };
  }
  const spec = TRANSITIONS[table].find(t => t.from === from && t.to === to);
  if (!spec) {
    return { ok: false, error: { code: 'illegal_transition', message: `Cannot move ${typeLabel(table)} from ${stateLabel(from)} to ${stateLabel(to)}.` } };
  }
  if (!spec.roles.some(r => roles.includes(r))) {
    return { ok: false, error: { code: 'role_not_allowed', message: `Your role cannot move this ${typeLabel(table)} to ${stateLabel(to)}.` } };
  }
  return { ok: true };
}

/** Required fields for a move, in table order. */
export function requiredFor(table: Table, from: string, to: string): string[] {
  const spec = TRANSITIONS[table].find(t => t.from === from && t.to === to);
  return spec ? spec.required : [];
}

/** The priority matrix with the business-critical bump. */
export function matrixPriority(impact: number | null, urgency: number | null, businessCritical: boolean): number | null {
  if (impact === null || urgency === null) return null;
  return compute_priority(impact, urgency, businessCritical);
}
