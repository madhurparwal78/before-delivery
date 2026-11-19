// Access evaluation: baseline grants, then table, row and field rules.
// One place decides what a person may see and do with a record.

import { Db } from './db.js';
import { Role, Table } from '../shared/model.js';
import { Ctx as ExprCtx, parse, evaluate, truthy } from '../express/expression.js';

export interface Viewer {
  username: string;
  display_name: string;
  roles: Role[];
  department: string;
  /** Department by username for row checks (managers). */
  departments: Map<string, string>;
}

export interface AccessRules {
  table: Array<{ table: string; operation: string; roles: string[] }>;
  row: Array<{ table: string; operation: string; roles: string[]; condition: string }>;
  field: Array<{ table: string; field: string; operation: string; roles: string[] }>;
}

const OPEN_TABLES: Table[] = ['incident', 'problem', 'change', 'request_item', 'task'];

/** May this viewer read this record at all? Baseline first, then row rules. */
export function canReadRecord(viewer: Viewer, rules: AccessRules, rec: {
  table: Table; number: string; state: string; fields: Record<string, unknown>;
}): boolean {
  if (viewer.roles.includes('operator')) return true;
  if (!baselineRead(viewer, rec)) return false;
  if (rowDenied(viewer, rules, rec, 'read')) return false;
  return true;
}

/** Row denial: any active row rule matching the record's table and operation,
 *  listing one of the viewer's roles, whose condition is true. */
export function rowDenied(viewer: Viewer, rules: AccessRules, rec: {
  table: Table; number: string; state: string; fields: Record<string, unknown>;
}, operation: 'read' | 'write'): boolean {
  if (viewer.roles.includes('operator')) return false;
  const candidates = rules.row.filter(r =>
    r.table === rec.table && r.operation === operation &&
    r.roles.some(role => viewer.roles.includes(role as Role)));
  if (!candidates.length) return false;
  const snap = { ...rec.fields, state: rec.state, number: rec.number };
  for (const rule of candidates) {
    if (evalRow(rule.condition, snap, viewer)) return true;
  }
  return false;
}

export function evalRow(condition: string, snap: Record<string, unknown>, viewer: Viewer): boolean {
  const ctx: ExprCtx = {
    rec: snap,
    now: 0,
    me: viewer.username,
    roles: new Set(viewer.roles),
    resolve: (path: string) => {
      let cur: unknown = snap;
      for (const part of path.split('.')) {
        if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
          cur = (cur as Record<string, unknown>)[part];
        } else {
          return null;
        }
      }
      return cur;
    },
  };
  try {
    return truthy(evaluate(parse(condition), ctx));
  } catch {
    return false;
  }
}

/** Baseline read grants. */
export function baselineRead(viewer: Viewer, rec: {
  table: Table; number: string; state: string; fields: Record<string, unknown>;
}): boolean {
  if (viewer.roles.includes('operator')) return true;
  if (!OPEN_TABLES.includes(rec.table)) return false;

  const caller = (rec.fields.caller ?? null) as string | null;
  const requestedFor = (rec.fields.requested_for ?? rec.fields.requester ?? null) as string | null;
  const isOwn = caller === viewer.username || requestedFor === viewer.username;

  if (viewer.roles.includes('technician')) {
    return ['incident', 'problem', 'task', 'request_item', 'change'].includes(rec.table);
  }
  if (viewer.roles.includes('manager')) {
    if (isOwn && ['incident', 'request_item'].includes(rec.table)) return true;
    if (rec.table === 'incident') {
      return caller !== null && (viewer.departments.get(caller) ?? '') === viewer.department;
    }
    if (rec.table === 'change') return false;
    return false;
  }
  if (viewer.roles.includes('approver')) {
    if (rec.table === 'change') return true;
    if (!isOwn) return false;
    return ['incident', 'request_item'].includes(rec.table);
  }
  if (viewer.roles.includes('requester')) {
    if (!isOwn) return false;
    return ['incident', 'request_item'].includes(rec.table);
  }
  return false;
}

/** Fields a viewer may read: null means everything. */
export function readableFields(viewer: Viewer, rules: AccessRules, table: Table): Set<string> | null {
  if (viewer.roles.includes('operator')) return null;
  const denied = new Set<string>();
  for (const rule of rules.field) {
    if (rule.table !== table) continue;
    if (rule.operation !== 'read') continue;
    if (!rule.roles.some(role => viewer.roles.includes(role as Role))) continue;
    denied.add(rule.field);
  }
  return denied.size ? denied : null;
}

/** Fields a viewer may write: null means everything the baseline allows. */
export function writableFields(viewer: Viewer, rules: AccessRules, table: Table): Set<string> | null {
  if (viewer.roles.includes('operator')) return null;
  const denied = new Set<string>();
  for (const rule of rules.field) {
    if (rule.table !== table) continue;
    if (rule.operation !== 'write') continue;
    if (!rule.roles.some(role => viewer.roles.includes(role as Role))) continue;
    denied.add(rule.field);
  }
  return denied.size ? denied : null;
}

/** Requester-side field baseline. */
export const REQUESTER_FIELDS = new Set(['number', 'short_description', 'description', 'state', 'priority', 'comments', 'attachments', 'caller']);

/** Load the active access rules once per request. */
export async function loadAccessRules(db: Db): Promise<AccessRules> {
  const res = await db.query(
    `SELECT name, type, "table", field, operation, roles, condition, active FROM access_rules WHERE active = TRUE`,
  );
  const rules: AccessRules = { table: [], row: [], field: [] };
  for (const row of res.rows) {
    const entry = {
      table: row.table,
      operation: row.operation,
      roles: row.roles as string[],
      condition: row.condition ?? 'true',
      field: row.field,
    };
    if (row.type === 'table') rules.table.push({ table: row.table, operation: row.operation, roles: row.roles });
    else if (row.type === 'row') rules.row.push(entry);
    else if (row.type === 'field') rules.field.push({ table: row.table, field: row.field, operation: row.operation, roles: row.roles });
  }
  return rules;
}
