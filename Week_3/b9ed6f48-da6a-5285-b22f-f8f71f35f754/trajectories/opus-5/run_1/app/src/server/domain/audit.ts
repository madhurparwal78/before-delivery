import { pool, query, type Tx } from '../db/index.js';
import { toLisbonIso } from '../../shared/lisbon.js';
import type { AuditRow } from '../../shared/types.js';

export type AuditAction =
  | 'item_created'
  | 'item_edited'
  | 'transition'
  | 'published'
  | 'media_uploaded'
  | 'source_created'
  | 'session_created'
  | 'session_cancelled'
  | 'refund'
  | 'order_note'
  | 'price_change';

export interface AuditEntry {
  actorEmail: string;
  action: AuditAction;
  targetType: string;
  targetId: string;
  detail?: Record<string, unknown>;
}

const INSERT = `INSERT INTO audit_log (actor_email, action, target_type, target_id, detail)
                VALUES ($1, $2, $3, $4, $5::jsonb)`;

/** Appends exactly one row. The record is never updated or deleted. */
export async function record(entry: AuditEntry, tx?: Tx): Promise<void> {
  const values = [
    entry.actorEmail,
    entry.action,
    entry.targetType,
    entry.targetId,
    JSON.stringify(entry.detail ?? {}),
  ];
  if (tx) await tx.query(INSERT, values);
  else await pool.query(INSERT, values);
}

interface AuditDbRow {
  id: string;
  at: Date;
  actor_email: string;
  action: string;
  target_type: string;
  target_id: string;
  detail: Record<string, unknown>;
}

export async function listAudit(): Promise<AuditRow[]> {
  const rows = await query<AuditDbRow>(
    `SELECT id::text, at, actor_email, action, target_type, target_id, detail
     FROM audit_log ORDER BY id DESC LIMIT 500`,
  );
  return rows.map((row) => ({
    id: row.id,
    at: toLisbonIso(row.at.getTime()),
    actor_email: row.actor_email,
    action: row.action,
    target_type: row.target_type,
    target_id: row.target_id,
    detail: row.detail,
  }));
}
