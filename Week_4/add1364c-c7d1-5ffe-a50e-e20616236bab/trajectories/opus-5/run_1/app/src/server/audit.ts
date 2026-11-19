import type { PoolClient } from 'pg';
import { inTransaction, query } from './db.js';
import { newId } from './secretStore.js';
import { officeDate, officeOffset, officeTimeOfDay, type OfficeDate } from './officeTime.js';
import { now } from './clock.js';

export type AuditAction =
  | 'reveal'
  | 'copy'
  | 'secret_edit'
  | 'credential_create'
  | 'vault_create'
  | 'vault_change'
  | 'vault_rename'
  | 'vendor_create'
  | 'vendor_change'
  | 'vendor_rename'
  | 'person_join'
  | 'person_change'
  | 'person_leave'
  | 'term_start'
  | 'term_end'
  | 'travel_set'
  | 'travel_cancel'
  | 'scope_removed'
  | 'rule_draft'
  | 'rule_edit'
  | 'rule_sign'
  | 'rule_in_force'
  | 'rule_superseded'
  | 'rotation_schedule'
  | 'rotation_change'
  | 'rotation_due'
  | 'rotation_overdue'
  | 'turn_due'
  | 'turn_done'
  | 'review_open'
  | 'review_overdue'
  | 'review_decision'
  | 'review_line_added'
  | 'review_sign_off'
  | 'import_row'
  | 'import_choice'
  | 'seat_waiting'
  | 'seat_confirmed'
  | 'seat_released';

export type Actor = { personId: string; name: string } | 'Lockset';

export type AuditEntryInput = {
  actor: Actor;
  action: AuditAction;
  subject: { kind: string; id: string | null; name: string };
  details?: Record<string, unknown>;
};

export type AuditWriter = (entry: AuditEntryInput) => Promise<string>;

/**
 * Runs a state change and its audit entries in one transaction. `seq` is taken
 * from a single counter row, so a higher `seq` was always committed later.
 */
export async function withAudit<T>(run: (client: PoolClient, write: AuditWriter) => Promise<T>): Promise<T> {
  return inTransaction(async (client) => {
    const write: AuditWriter = async (entry) => {
      const at = now();
      const seqRows = await client.query<{ seq: string }>(
        'update audit_counter set seq = seq + 1 where id = 1 returning seq',
      );
      const seq = Number(seqRows.rows[0]?.seq ?? 0);
      const entryId = newId();
      await client.query(
        `insert into audit (id, seq, at, office_day, office_time, offset_name, actor_person_id, actor_name,
                            action, subject_kind, subject_id, subject_name, details)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          entryId,
          seq,
          at,
          officeDate(at),
          officeTimeOfDay(at),
          officeOffset(at),
          entry.actor === 'Lockset' ? null : entry.actor.personId,
          entry.actor === 'Lockset' ? null : entry.actor.name,
          entry.action,
          entry.subject.kind,
          entry.subject.id,
          entry.subject.name,
          JSON.stringify(entry.details ?? {}),
        ],
      );
      return entryId;
    };
    return run(client, write);
  });
}

export type AuditRow = {
  id: string;
  seq: string;
  at: Date;
  office_day: Date;
  office_time: string;
  offset_name: string;
  actor_person_id: string | null;
  actor_name: string | null;
  action: string;
  subject_kind: string;
  subject_id: string | null;
  subject_name: string;
  details: Record<string, unknown>;
};

export type AuditCursor = { day: OfficeDate; order: 'oldest' | 'newest'; seq: number };

export function encodeCursor(cursor: AuditCursor): string {
  return Buffer.from(JSON.stringify([cursor.day, cursor.order, cursor.seq]), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): AuditCursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 3) return null;
    const [day, order, seq] = parsed as [unknown, unknown, unknown];
    if (typeof day !== 'string' || (order !== 'oldest' && order !== 'newest') || typeof seq !== 'number') return null;
    return { day, order, seq };
  } catch {
    return null;
  }
}

/** Keyset paging over one office day. Paging continues from the last `seq` returned. */
export async function readAuditPage(options: {
  day: OfficeDate;
  order: 'oldest' | 'newest';
  limit: number;
  after: AuditCursor | null;
}): Promise<{ entries: AuditRow[]; nextCursor: string | null }> {
  const { day, order, limit, after } = options;
  const ascending = order === 'oldest';
  const bound = after === null ? null : after.seq;
  const rows = await query<AuditRow>(
    `select * from audit
      where office_day = $1
        and ($2::bigint is null or ${ascending ? 'seq > $2::bigint' : 'seq < $2::bigint'})
      order by seq ${ascending ? 'asc' : 'desc'}
      limit $3`,
    [day, bound, limit],
  );
  const last = rows[rows.length - 1];
  let nextCursor: string | null = null;
  if (last !== undefined && rows.length === limit) {
    const moreRows = await query<{ exists: boolean }>(
      `select exists(
         select 1 from audit where office_day = $1 and ${ascending ? 'seq > $2::bigint' : 'seq < $2::bigint'}
       ) as exists`,
      [day, Number(last.seq)],
    );
    if (moreRows[0]?.exists === true) {
      nextCursor = encodeCursor({ day, order, seq: Number(last.seq) });
    }
  }
  return { entries: rows, nextCursor };
}

export function auditEntryJson(row: AuditRow): Record<string, unknown> {
  return {
    id: row.id,
    seq: Number(row.seq),
    at: row.at.toISOString(),
    office_day: officeDate(row.at),
    office_time: row.office_time,
    offset: row.offset_name,
    actor:
      row.actor_person_id === null
        ? { system: 'Lockset' }
        : { person_id: row.actor_person_id, name: row.actor_name },
    action: row.action,
    subject: { kind: row.subject_kind, id: row.subject_id, name: row.subject_name },
    details: row.details,
  };
}
