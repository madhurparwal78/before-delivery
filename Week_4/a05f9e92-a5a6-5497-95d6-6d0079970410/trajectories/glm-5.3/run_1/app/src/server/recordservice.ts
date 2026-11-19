// The record service: create, save with field versions, transition.
// Every domain rule about saving records is decided here.

import { Db, clock } from './db.js';
import { ApiError } from './errors.js';
import { Table, Role, TRANSITIONS, STATE_LABELS, compute_priority, TABLE_LABEL } from '../shared/model.js';
import { FieldSpecMeta, RecordSnapshot, allocateNumber, fieldLabel, stateLabel, typeLabel } from './recordengine.js';
import { Ctx as ExprCtx, parse, evaluate, truthy } from '../express/expression.js';

export interface SaveRequest {
  fields: Record<string, { value: unknown; version?: number }>;
}

export interface SaveOutcome {
  record: RecordSnapshot;
  audit: Array<{ field: string; before: unknown; after: unknown }>;
  activity: string[];
  applied: boolean;
  conflicts?: Array<{ field: string; label: string; yours: unknown; theirs: unknown; theirs_by: string; version: number }>;
}

export const INITIAL_STATES: Record<Table, string> = {
  incident: 'new',
  problem: 'new',
  change: 'draft',
  request_item: 'submitted',
  task: 'open',
};

/** Create a record: allocate a number in the same transaction. */
export async function createRecord(
  db: Db,
  table: Table,
  fields: Record<string, unknown>,
  actor: { username: string; actingFor: string | null },
  workspace: 'live' | 'test',
): Promise<RecordSnapshot> {
  return db.withTransaction(async (client) => {
    const now = clock.nowMs();
    const number = await allocateNumber(client, table);
    const snapshot: RecordSnapshot = {
      number,
      table,
      state: INITIAL_STATES[table],
      workspace,
      fields: { ...fields, created_at: new Date(now).toISOString() },
      priority_overridden: false,
      created_at: now,
      created_by: actor.username,
    };
    await client.query(
      `INSERT INTO records(number, "table", state, workspace, fields, priority_overridden, created_at, created_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,FALSE,$6,$7,$6)`,
      [number, table, snapshot.state, workspace, JSON.stringify(snapshot.fields), new Date(now), actor.username],
    );
    await client.query(`INSERT INTO state_history(record, state, at) VALUES ($1,$2,$3)`, [number, snapshot.state, new Date(now)]);
    for (const field of Object.keys(snapshot.fields)) {
      await client.query(`INSERT INTO field_versions(record, field, version) VALUES ($1,$2,1) ON CONFLICT DO NOTHING`, [number, field]);
    }
    return snapshot;
  });
}

/** Save with per-field versions. A stale version on a changed field is 409. */
export async function saveRecord(
  db: Db,
  before: RecordSnapshot,
  requested: Record<string, { value: unknown; version?: number }>,
  actor: { username: string; actingFor: string | null },
): Promise<SaveOutcome> {
  return db.withTransaction(async (client) => {
    const now = clock.nowMs();
    const versions = await loadVersions(client, before.number);
    const audit: Array<{ field: string; before: unknown; after: unknown }> = [];
    const newFields: Record<string, unknown> = { ...before.fields };

    // Conflict check first: every named field version must be current.
    const conflicts: SaveOutcome['conflicts'] = [];
    for (const [field, spec] of Object.entries(requested)) {
      const current = versions.get(field) ?? 1;
      if (spec.version !== undefined && spec.version < current) {
        const theirs = before.fields[field] ?? null;
        conflicts.push({
          field,
          label: fieldLabel(before.table, field),
          yours: spec.value,
          theirs,
          theirs_by: actor.username,
          version: current,
        });
      }
    }
    if (conflicts?.length) {
      throw new ApiError(409, 'field_conflict', `Conflict on ${conflicts[0].label}: ${conflicts[0].theirs_by} saved a newer value.`, undefined, { conflicts });
    }

    // Apply each field, bumping its version when the value changes.
    for (const [field, spec] of Object.entries(requested)) {
      const before2 = newFields[field] ?? null;
      if (!valueEquals(before2, spec.value)) {
        newFields[field] = spec.value;
        audit.push({ field, before: before2, after: spec.value });
        await client.query(
          `INSERT INTO field_versions(record, field, version) VALUES ($1,$2,2)
           ON CONFLICT (record, field) DO UPDATE SET version = field_versions.version + 1`,
          [before.number, field],
        );
      }
    }

    if (audit.length) {
      await client.query(
        `UPDATE records SET fields = $2, updated_at = $3 WHERE number = $1`,
        [before.number, JSON.stringify(newFields), new Date(now)],
      );
      for (const entry of audit) {
        await client.query(
          `INSERT INTO audit(record, at, actor, acting_for, field, before, after, reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NULL)`,
          [before.number, new Date(now), actor.username, actor.actingFor, entry.field,
           JSON.stringify(entry.before), JSON.stringify(entry.after)],
        );
      }
    }

    return {
      record: { ...before, fields: newFields },
      audit,
      activity: [],
      applied: audit.length > 0,
    };
  });
}

function valueEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

async function loadVersions(client: { query: (sql: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }, number: string): Promise<Map<string, number>> {
  const res = await client.query(`SELECT field, version FROM field_versions WHERE record = $1`, [number]);
  const out = new Map<string, number>();
  for (const row of res.rows) out.set(String(row.field), Number(row.version));
  return out;
}

/** Transition a record. The published table decides legality; the required
 *  fields are checked in table order; the first missing one is reported. */
export async function transitionRecord(
  db: Db,
  before: RecordSnapshot,
  to: string,
  requested: Record<string, { value: unknown; version?: number }>,
  roles: Role[],
  actor: { username: string; actingFor: string | null },
): Promise<{ record: RecordSnapshot; audit: Array<{ field: string; before: unknown; after: unknown }> }> {
  const table = before.table;
  const spec = TRANSITIONS[table].find(t => t.from === before.state && t.to === to);
  if (!spec) {
    throw new ApiError(422, 'illegal_transition', `Cannot move ${typeLabel(table)} from ${stateLabel(before.state)} to ${stateLabel(to)}.`);
  }
  if (!spec.roles.some(r => roles.includes(r))) {
    throw new ApiError(422, 'role_not_allowed', `Your role cannot move this ${typeLabel(table)} to ${stateLabel(to)}.`);
  }

  const merged = { ...before.fields };
  for (const [field, req] of Object.entries(requested)) {
    merged[field] = req.value;
  }
  for (const field of spec.required) {
    if (isEmpty(merged[field])) {
      throw new ApiError(422, 'field_required', `${fieldLabel(table, field)} is required to move to ${stateLabel(to)}.`, { [field]: `${fieldLabel(table, field)} is required to move to ${stateLabel(to)}.` });
    }
  }

  // Apply the save part first (with conflict checks), then the state change.
  const outcome = await saveRecord(db, before, requested, actor);
  const now = clock.nowMs();
  const after: RecordSnapshot = { ...outcome.record, state: to };
  if (after.table === 'incident' && to === 'resolved') {
    after.fields.resolved_at = new Date(now).toISOString();
  }

  await db.withTransaction(async (client) => {
    await client.query(`UPDATE records SET state = $2, updated_at = $3 WHERE number = $1`, [before.number, to, new Date(now)]);
    await client.query(`INSERT INTO state_history(record, state, at) VALUES ($1,$2,$3)`, [before.number, to, new Date(now)]);
    if (after.table === 'incident' && to === 'resolved') {
      await client.query(`UPDATE records SET fields = $2 WHERE number = $1`, [before.number, JSON.stringify(after.fields)]);
    }
  });

  return { record: after, audit: outcome.audit };
}

export function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === '' ||
    (typeof value === 'string' && value.trim() === '');
}
