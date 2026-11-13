import type { Client } from '../db/pool.js';

export type EventType =
  | 'stock' | 'price' | 'collection' | 'order' | 'return' | 'trial' | 'warranty'
  | 'cart' | 'wishlist' | 'notification' | 'queue';

export type EventScope = { userId: number | null; sessionId: string | null; staffVisible: boolean };

/** One shared sequence, never skipping or repeating, written with the change. */
export async function publish(
  client: Client,
  type: EventType,
  data: Record<string, unknown>,
  scope: EventScope,
): Promise<number> {
  const res = await client.query<{ seq: string }>(
    `INSERT INTO live_events (type, scope_user, scope_session, staff_visible, data)
     VALUES ($1, $2, $3, $4, $5) RETURNING seq`,
    [type, scope.userId, scope.sessionId, scope.staffVisible, JSON.stringify(data)]);
  return Number(res.rows[0].seq);
}

export type LiveRow = { seq: string; type: EventType; scope_user: string | null; scope_session: string | null; staff_visible: boolean; data: Record<string, unknown>; at: Date };

export async function eventsSince(client: Client, after: number, limit = 200): Promise<LiveRow[]> {
  const res = await client.query<LiveRow>(
    `SELECT seq::TEXT AS seq, type, scope_user::TEXT AS scope_user, scope_session, staff_visible, data, at
     FROM live_events WHERE seq > $1 ORDER BY seq ASC LIMIT $2`, [after, limit]);
  return res.rows;
}

export async function firstEventSeq(client: Client): Promise<number> {
  const res = await client.query<{ seq: string | null }>(`SELECT MIN(seq)::TEXT AS seq FROM live_events`);
  return res.rows[0].seq === null ? 0 : Number(res.rows[0].seq);
}

/** Who may see an event. */
export function visibleTo(row: { scope_user: string | null; scope_session: string | null; staff_visible: boolean }, viewer: { userId: number | null; sessionId: string; staff: boolean }): boolean {
  if (row.scope_user === null && row.scope_session === null) return true;
  if (viewer.staff && row.staff_visible) return true;
  if (row.scope_user !== null && viewer.userId !== null && Number(row.scope_user) === viewer.userId) return true;
  if (row.scope_session !== null && row.scope_session === viewer.sessionId) return true;
  return false;
}
