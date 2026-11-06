import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Role } from '../../shared/types.js';
import type { Db } from '../db.js';
import { conflict, forbidden, notFound } from '../errors.js';
import type { Ctx } from '../http.js';
import { findLine, findMission, findVessel, type LineRow, type MissionRow, type UserRow, type VesselRow } from '../repo.js';

/** Serialises work on one record. Callers already hold a transaction. */
const NAMESPACES = { vessel: 1, mission: 2, line: 3, holiday: 4, attempt: 5 } as const;

export async function lockRecord(
  client: PoolClient,
  kind: keyof typeof NAMESPACES,
  id: string,
): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [NAMESPACES[kind], id]);
}

export async function lockVessels(client: PoolClient, ids: string[]): Promise<void> {
  for (const id of [...new Set(ids)].sort()) await lockRecord(client, 'vessel', id);
}

/** A resource the caller may not see is never confirmed to exist. */
export async function missionInScope(db: Db, user: UserRow, missionId: string): Promise<MissionRow> {
  const mission = await findMission(db, missionId);
  if (!mission) throw notFound();
  if (user.role === 'client_reviewer' && mission.client_org_id !== user.client_org_id) {
    throw notFound();
  }
  return mission;
}

export async function lineInScope(
  db: Db,
  user: UserRow,
  missionId: string,
  lineId: string,
): Promise<{ mission: MissionRow; line: LineRow }> {
  const mission = await missionInScope(db, user, missionId);
  const line = await findLine(db, lineId);
  if (!line || line.mission_id !== mission.id) throw notFound();
  return { mission, line };
}

/** A line reached by its own id, scoped through the mission it belongs to. */
export async function lineByIdInScope(
  db: Db,
  user: UserRow,
  lineId: string,
): Promise<{ mission: MissionRow; line: LineRow }> {
  const line = await findLine(db, lineId);
  if (!line) throw notFound();
  const mission = await missionInScope(db, user, line.mission_id);
  return { mission, line };
}

export async function vesselOr404(db: Db, vesselId: string): Promise<VesselRow> {
  const vessel = await findVessel(db, vesselId);
  if (!vessel) throw notFound();
  return vessel;
}

export function staffOnly(user: UserRow): UserRow {
  if (user.role === 'client_reviewer') throw forbidden();
  return user;
}

export function rolesOnly(user: UserRow, roles: Role[]): UserRow {
  if (!roles.includes(user.role)) throw forbidden();
  return user;
}

export function bodyHash(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

export function idempotencyKey(ctx: Ctx): string | null {
  const header = ctx.req.headers['idempotency-key'];
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined || value.length === 0 || value.length > 100) return null;
  return value;
}

export interface IdempotentResult {
  status: number;
  payload: unknown;
}

/**
 * Runs an operation under an idempotency key. The same key with the same body
 * returns the original response and creates nothing; a different body answers
 * `409 idempotency_conflict`; simultaneous keys create exactly one record because
 * the second insert waits on the first's unique index entry.
 */
export async function runIdempotent(
  client: PoolClient,
  userId: string,
  endpoint: string,
  key: string | null,
  body: unknown,
  run: () => Promise<IdempotentResult>,
): Promise<IdempotentResult> {
  if (key === null) return run();
  const hash = bodyHash(body);
  const claimed = await client.query(
    `INSERT INTO idempotency_keys (user_id, endpoint, key, body_hash, status, response)
     VALUES ($1,$2,$3,$4,0,'null'::jsonb)
     ON CONFLICT (user_id, endpoint, key) DO NOTHING RETURNING key`,
    [userId, endpoint, key, hash],
  );
  if (claimed.rowCount === 1) {
    const result = await run();
    await client.query(
      `UPDATE idempotency_keys SET status = $5, response = $6
       WHERE user_id = $1 AND endpoint = $2 AND key = $3 AND body_hash = $4`,
      [userId, endpoint, key, hash, result.status, JSON.stringify(result.payload)],
    );
    return result;
  }
  const existing = await client.query<{ body_hash: string; status: number; response: unknown }>(
    `SELECT body_hash, status, response FROM idempotency_keys
     WHERE user_id = $1 AND endpoint = $2 AND key = $3`,
    [userId, endpoint, key],
  );
  const row = existing.rows[0];
  if (!row || row.body_hash !== hash) {
    throw conflict('idempotency_conflict', 'That idempotency key was used with a different body.');
  }
  return { status: row.status, payload: row.response };
}
