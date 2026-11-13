import * as pg from 'pg';

export type NoticeKind = 'deadline_locked' | 'transfer_refused' | 'auto_sub' | 'price_change';

export interface NoticeRequest {
  manager_id: string;
  pocketbase_user_id: string;
  kind: NoticeKind;
  gameweek: number;
  message: string;
}

export interface OutboxRow {
  id: string;
  pocketbase_user_id: string;
  manager_id: string;
  kind: string;
  gameweek: number;
  message: string;
}

export async function queueNotices(client: pg.PoolClient, requests: NoticeRequest[]): Promise<void> {
  for (const request of requests) {
    const id = noticeId(request);
    await client.query(
      `INSERT INTO notice_outbox (id, pocketbase_user_id, manager_id, kind, gameweek, message)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id, pocketbase_user_id) DO NOTHING`,
      [id, request.pocketbase_user_id, request.manager_id, request.kind, request.gameweek, request.message],
    );
  }
}

export function noticeId(request: NoticeRequest): string {
  const basis = `${request.manager_id}:${request.pocketbase_user_id}:${request.kind}:${request.gameweek}:${request.message}`;
  let h = 0;
  for (let i = 0; i < basis.length; i += 1) {
    h = (h * 31 + basis.charCodeAt(i)) | 0;
  }
  return `n${(h >>> 0).toString(36)}`;
}

export async function fetchUndelivered(pool: pg.Pool, limit: number): Promise<OutboxRow[]> {
  const { rows } = await pool.query<OutboxRow>(
    `SELECT id, pocketbase_user_id, manager_id, kind, gameweek, message
       FROM notice_outbox
      WHERE delivered_at IS NULL
      ORDER BY created_at, id
      LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function markDelivered(pool: pg.Pool, id: string, pocketbaseUserId: string): Promise<void> {
  await pool.query(
    'UPDATE notice_outbox SET delivered_at = now() WHERE id = $1 AND pocketbase_user_id = $2 AND delivered_at IS NULL',
    [id, pocketbaseUserId],
  );
}
