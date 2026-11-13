import type { Tx } from './db.js';
import { randomUUID } from 'node:crypto';

export interface NoticeRow {
  notice_id: string;
  position_id: string;
  kind: 'margin' | 'liquidation';
  status: 'queued' | 'sent';
  created_at: Date;
  sent_at: Date | null;
}

/** Queue a notice for a position. */
export async function noticesFor(tx: Tx, positionId: string, kind: 'margin' | 'liquidation', at: Date): Promise<string> {
  const noticeId = randomUUID();
  await tx.query(
    `INSERT INTO notices (notice_id, position_id, kind, status, created_at) VALUES ($1, $2, $3, 'queued', $4)`,
    [noticeId, positionId, kind, at],
  );
  return noticeId;
}

export async function listNotices(client: Tx['client'], positionId: string): Promise<NoticeRow[]> {
  const result = await client.query<{ notice_id: string; position_id: string; kind: 'margin' | 'liquidation'; status: 'queued' | 'sent'; created_at: Date; sent_at: Date | null }>(
    'SELECT notice_id, position_id, kind, status, created_at, sent_at FROM notices WHERE position_id = $1 ORDER BY created_at, notice_id',
    [positionId],
  );
  return result.rows;
}
