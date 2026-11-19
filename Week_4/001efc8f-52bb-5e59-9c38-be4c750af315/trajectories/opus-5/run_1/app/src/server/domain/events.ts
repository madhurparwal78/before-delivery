import type { PoolClient } from 'pg';
import { pool, query, queryOne } from '../db';
import { nowDate } from '../clock';
import { config } from '../config';
import { loadChannelFor } from './channels';

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

export interface LoggedEvent {
  id: number;
  type: EventType;
  data: Record<string, unknown>;
}

export interface EventInput {
  workspaceId: string;
  channelId?: string | null;
  targetUserId?: string | null;
  type: EventType;
  payload: Record<string, unknown>;
}

const EVENT_SEQUENCE_LOCK = 7701;

/**
 * Appends to the event log. One advisory lock serialises the whole append, so
 * ids become visible in the order they were taken and no reader can skip an
 * event that commits late.
 */
export async function publish(events: EventInput[]): Promise<void> {
  if (events.length === 0) return;
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [EVENT_SEQUENCE_LOCK]);
    const loggedAt = nowDate();
    for (const event of events) {
      await client.query(
        `INSERT INTO event_log (workspace_id, channel_id, target_user_id, type, payload, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [
          event.workspaceId,
          event.channelId ?? null,
          event.targetUserId ?? null,
          event.type,
          JSON.stringify(event.payload),
          loggedAt,
        ],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

interface EventRow {
  id: number;
  type: EventType;
  payload: Record<string, unknown>;
  channel_id: string | null;
}

/**
 * The one rule for which logged events a person may receive. Judged against
 * their workspace and their memberships as they stand now, so a channel lost
 * since the named id yields only its revocation.
 */
const DELIVERABLE_SQL = `
  SELECT e.id, e.type, e.payload, e.channel_id
  FROM event_log e
  WHERE e.id > $1 AND e.workspace_id = $2
    AND (
      (e.target_user_id = $3 AND (
        e.channel_id IS NULL
        OR e.type = 'channel.revoked'
        OR EXISTS (SELECT 1 FROM channel_members cm WHERE cm.channel_id = e.channel_id AND cm.user_id = $3)))
      OR (e.target_user_id IS NULL AND e.channel_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM channel_members cm WHERE cm.channel_id = e.channel_id AND cm.user_id = $3)))
  ORDER BY e.id ASC
  LIMIT 500`;

async function deliverableEvents(userId: string, workspaceId: string, afterId: number): Promise<LoggedEvent[]> {
  const rows = await query<EventRow>(DELIVERABLE_SQL, [afterId, workspaceId, userId]);
  const events: LoggedEvent[] = [];
  for (const row of rows) {
    const data = await materialize(row, userId);
    if (data !== null) events.push({ id: Number(row.id), type: row.type, data });
  }
  return events;
}

async function materialize(row: EventRow, userId: string): Promise<Record<string, unknown> | null> {
  if (row.type === 'channel.updated' || row.type === 'channel.added') {
    const channelId = row.channel_id;
    if (channelId === null) return null;
    const channel = await loadChannelFor(userId, channelId);
    if (channel === null) return null;
    return { channel };
  }
  return row.payload;
}

export async function newestEventId(): Promise<number> {
  const row = await queryOne<{ max: number | null }>('SELECT max(id) AS max FROM event_log');
  return row?.max === null || row?.max === undefined ? 0 : Number(row.max);
}

export async function oldestRetainedEventId(): Promise<number> {
  const row = await queryOne<{ min: number | null }>('SELECT min(id) AS min FROM event_log');
  return row?.min === null || row?.min === undefined ? 0 : Number(row.min);
}

export interface Subscriber {
  userId: string;
  workspaceId: string;
  lastSentId: number;
  deliver(event: LoggedEvent): void;
  finish(): void;
}

class EventHub {
  private readonly subscribers = new Set<Subscriber>();
  private readonly busy = new Set<Subscriber>();
  private timer: NodeJS.Timeout | null = null;

  add(subscriber: Subscriber): void {
    this.subscribers.add(subscriber);
    void this.pump(subscriber);
  }

  remove(subscriber: Subscriber): void {
    this.subscribers.delete(subscriber);
    this.busy.delete(subscriber);
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      for (const subscriber of this.subscribers) void this.pump(subscriber);
    }, 250);
    this.timer.unref();
  }

  private async pump(subscriber: Subscriber): Promise<void> {
    if (this.busy.has(subscriber)) return;
    this.busy.add(subscriber);
    try {
      for (;;) {
        const events = await deliverableEvents(subscriber.userId, subscriber.workspaceId, subscriber.lastSentId);
        if (events.length === 0) return;
        for (const event of events) {
          subscriber.lastSentId = event.id;
          subscriber.deliver(event);
          if (event.type === 'session.ended') {
            subscriber.finish();
            this.remove(subscriber);
            return;
          }
        }
        if (events.length < 500) return;
      }
    } catch {
      /* the next tick retries */
    } finally {
      this.busy.delete(subscriber);
    }
  }
}

export const eventHub = new EventHub();

export async function pruneEventLog(): Promise<void> {
  await query('DELETE FROM event_log WHERE created_at < $1', [
    new Date(nowDate().getTime() - (config.eventRetentionSeconds + 120) * 1000),
  ]);
}
