import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { officeDateString, officeTimeString, offsetAbbreviation } from '../officeTime.js';
import type { ServerClock } from '../clock.js';

export type Actor =
  | { personId: string; name: string }
  | { system: 'Lockset' };

export interface AuditEntryDraft {
  actor: Actor;
  action: string;
  subject: { kind: string; id: string; name: string };
  details?: Record<string, unknown>;
}

export interface AuditEntry {
  id: string;
  seq: number;
  at: string;
  office_day: string;
  office_time: string;
  offset: string;
  actor: { person_id?: string; name?: string; system?: string };
  action: string;
  subject: { kind: string; id: string; name: string };
  details: Record<string, unknown>;
}

/**
 * The append-only audit trail. Every state change writes its listed entries here,
 * each with a commit-ordered `seq` assigned inside the same transaction as the change.
 */
export class AuditTrail {
  constructor(private readonly pool: Pool, private readonly clock: ServerClock) {}

  async write(client: PoolClient, drafts: AuditEntryDraft[]): Promise<void> {
    if (drafts.length === 0) return;
    const now = this.clock.now();
    const officeDay = officeDateString(now);
    const officeTime = officeTimeString(now);
    const offset = offsetAbbreviation(now);
    const seqResult = await client.query(
      'UPDATE audit_seq_state SET last_seq = last_seq + $1 WHERE id = true RETURNING last_seq',
      [drafts.length]
    );
    let seq = Number(seqResult.rows[0].last_seq) - drafts.length + 1;
    for (const draft of drafts) {
      const at = this.clock.now();
      const actor = 'personId' in draft.actor
        ? { person_id: draft.actor.personId, name: draft.actor.name, system: undefined }
        : { person_id: undefined, name: 'Lockset', system: 'Lockset' };
      await client.query(
        `INSERT INTO audit_entries (id, seq, at, office_day, office_time, offset_abbrev, actor_kind, actor_person_id, actor_name, action, subject_kind, subject_id, subject_name, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          randomUUID(),
          seq,
          at,
          officeDay,
          officeTime,
          offset,
          'personId' in draft.actor ? 'person' : 'system',
          'personId' in draft.actor ? draft.actor.personId : null,
          'personId' in draft.actor ? draft.actor.name : 'Lockset',
          draft.action,
          draft.subject.kind,
          draft.subject.id,
          draft.subject.name,
          JSON.stringify(draft.details ?? {})
        ]
      );
      seq += 1;
    }
  }

  /** Audit entries of one office day in the given direction, after a cursor seq. */
  async page(
    day: string,
    order: 'oldest' | 'newest',
    limit: number,
    afterSeq: number | null
  ): Promise<{ entries: AuditEntry[]; nextCursor: string | null }> {
    const where = afterSeq === null ? '' : 'AND seq > $2';
    const params = afterSeq === null ? [day, limit] : [day, afterSeq, limit];
    const rows = await this.pool.query(
      `SELECT * FROM audit_entries WHERE office_day = $1 ${where} ORDER BY seq ASC LIMIT ${'$' + String(params.length)}`,
      params
    );
    let entries = rows.rows;
    if (order === 'newest') {
      entries = [...rows.rows].reverse();
    }
    const hasMore = rows.rows.length === limit;
    const nextCursor = hasMore && rows.rows.length > 0 ? encodeCursor(day, order, Number(rows.rows[rows.rows.length - 1].seq)) : null;
    return { entries: entries.map(mapEntry), nextCursor };
  }

  /** The newest entries of the office day for the back-of-the-drawer footer. */
  async newestOfDay(day: string, limit: number): Promise<AuditEntry[]> {
    const rows = await this.pool.query(
      'SELECT * FROM audit_entries WHERE office_day = $1 ORDER BY seq DESC LIMIT $2',
      [day, limit]
    );
    return rows.rows.map(mapEntry).reverse();
  }
}

export function mapEntry(row: Record<string, unknown>): AuditEntry {
  const actorPersonId = row.actor_person_id as string | null;
  const actorName = row.actor_name as string;
  return {
    id: String(row.id),
    seq: Number(row.seq),
    at: new Date(row.at as string).toISOString(),
    office_day: String(row.office_day),
    office_time: String(row.office_time),
    offset: String(row.offset),
    actor: actorPersonId
      ? { person_id: actorPersonId, name: actorName }
      : { system: 'Lockset' },
    action: String(row.action),
    subject: {
      kind: String(row.subject_kind),
      id: String(row.subject_id ?? ''),
      name: String(row.subject_name ?? '')
    },
    details: (row.details as Record<string, unknown>) ?? {}
  };
}

/** Cursors are opaque: base64 of `day|order|seq`, bound to their day and order. */
export function encodeCursor(day: string, order: 'oldest' | 'newest', seq: number): string {
  return Buffer.from(`${day}|${order}|${seq}`, 'utf8').toString('base64');
}

export function decodeCursor(cursor: string): { day: string; order: 'oldest' | 'newest'; seq: number } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf8');
    const parts = decoded.split('|');
    if (parts.length !== 3) return null;
    const day = parts[0];
    const order = parts[1] === 'newest' ? 'newest' : parts[1] === 'oldest' ? 'oldest' : null;
    const seq = Number(parts[2]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || order === null || !Number.isInteger(seq)) return null;
    return { day, order, seq };
  } catch {
    return null;
  }
}
