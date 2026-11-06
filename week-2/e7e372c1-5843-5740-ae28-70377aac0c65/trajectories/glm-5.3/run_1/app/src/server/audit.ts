// Audit-trail writes and reads. The single decision point for the append-only
// audit trail; every stored change writes exactly one entry here.

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./db.js";
import type { AuditEntryRecord, RestatementState } from "./types.js";

export async function writeAudit(
  client: PoolClient,
  restatementId: string,
  version: number,
  action: string,
  actorId: string | null,
  at: number,
  fromState: RestatementState | null,
  toState: RestatementState,
  note: string | null,
): Promise<void> {
  await client.query(
    `INSERT INTO restatement_audit (restatement_id, version, action, actor_id, at, from_state, to_state, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [restatementId, version, action, actorId, String(at), fromState, toState, note],
  );
}

export async function loadAudit(id: string): Promise<AuditEntryRecord[]> {
  const { rows } = await pool.query(
    `SELECT a.version, a.action, a.actor_id, a.at, a.from_state, a.to_state, a.note, u.name AS actor_name
       FROM restatement_audit a LEFT JOIN staff_users u ON u.id = a.actor_id
      WHERE a.restatement_id = $1 ORDER BY a.version`,
    [id],
  );
  return rows.map((r) => ({
    version: r.version as number,
    action: r.action as string,
    actor: r.actor_id ? { id: r.actor_id as string, name: r.actor_name as string } : null,
    at: Number(r.at),
    from_state: (r.from_state as RestatementState | null) ?? null,
    to_state: r.to_state as RestatementState,
    note: (r.note as string | null) ?? null,
  }));
}

export { randomUUID };
