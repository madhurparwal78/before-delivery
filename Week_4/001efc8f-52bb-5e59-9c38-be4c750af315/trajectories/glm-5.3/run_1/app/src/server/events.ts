import type { Db } from './db';

export type EventType =
  | 'message.created'
  | 'message.updated'
  | 'message.deleted'
  | 'receipts.updated'
  | 'channel.updated'
  | 'channel.added'
  | 'channel.revoked'
  | 'stream.reset'
  | 'session.ended';

/**
 * Events are appended to the PostgreSQL event log; each SSE connection
 * replays the rows its person may still receive (decided in EventHub).
 */
export async function logChannelEvent(
  db: Db,
  clock: { now(): Date },
  type: EventType,
  workspaceId: string,
  channelId: string | null,
  data: Record<string, unknown>,
): Promise<void> {
  await db.pool.query(
    'INSERT INTO event_log (workspace_id, user_id, channel_id, type, data, created_at) VALUES ($1, NULL, $2, $3, $4, $5)',
    [workspaceId, channelId, type, JSON.stringify(data), clock.now()],
  );
}

export async function logPersonalEvent(
  db: Db,
  clock: { now(): Date },
  type: EventType,
  workspaceId: string,
  userId: string,
  data: Record<string, unknown>,
): Promise<void> {
  await db.pool.query(
    'INSERT INTO event_log (workspace_id, user_id, channel_id, type, data, created_at) VALUES ($1, $2, NULL, $3, $4, $5)',
    [workspaceId, userId, type, JSON.stringify(data), clock.now()],
  );
}

export async function pruneEventLog(db: Db, retentionSeconds: number, now: Date): Promise<void> {
  await db.pool.query('DELETE FROM event_log WHERE created_at < $1', [new Date(now.getTime() - retentionSeconds * 1000)]);
}
