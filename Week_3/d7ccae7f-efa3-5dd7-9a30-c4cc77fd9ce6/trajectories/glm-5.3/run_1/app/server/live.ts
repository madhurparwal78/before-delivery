import { Redis } from 'ioredis';
import { config } from './config.ts';
import type { Standing } from './domain.ts';

export interface RoomEvent {
  id: number;
  type: string;
  data: unknown;
}

const publisher = new Redis(config.valkeyUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  retryStrategy: (times) => Math.min(5000, 500 + times * 250),
});
publisher.on('error', () => {
  /* retried by the connection loop */
});

const subscriber = publisher.duplicate();
subscriber.on('error', () => {
  /* retried by the connection loop */
});

const SUBSCRIBED = new Set<string>();
const WAITERS = new Map<string, Set<(roomEvent: RoomEvent) => void>>();

subscriber.on('message', (channel, message) => {
  const roomId = channel.startsWith('lastbell:room:') ? channel.slice('lastbell:room:'.length) : null;
  if (!roomId) return;
  let parsed: RoomEvent;
  try {
    parsed = JSON.parse(message) as RoomEvent;
  } catch {
    return;
  }
  const waiting = WAITERS.get(roomId);
  if (waiting) {
    for (const waiter of waiting) {
      try {
        waiter(parsed);
      } catch (err) {
        console.error('subscriber callback failed', err);
      }
    }
  }
});

export async function connectLive(): Promise<void> {
  for (const client of [publisher, subscriber]) {
    if (client.status !== 'ready' && client.status !== 'connecting' && client.status !== 'connect') {
      try {
        await client.connect();
      } catch {
        /* retried by the health loop */
      }
    }
  }
}

export function isLiveUp(): boolean {
  return publisher.status === 'ready' && subscriber.status === 'ready';
}

export async function appendEvent(
  db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  roomId: string,
  type: string,
  data: unknown,
): Promise<RoomEvent> {
  const insert = await db.query(
    `insert into events (room_id, id, type, data, created_at)
     values ($1, (select coalesce(max(id),0) + 1 from events where room_id = $1), $2, $3, $4)
     returning id`,
    [roomId, type, JSON.stringify(data), Date.now()],
  );
  if (!insert.rows || insert.rows.length === 0) throw new Error('event insert failed');
  const event: RoomEvent = { id: Number(insert.rows[0].id), type, data };
  await db.query(
    `update snapshots set last_event_id = $2 where id = (select snapshot_id from rooms where id = $1)`,
    [roomId, event.id],
  );
  return event;
}

export function publishEvent(roomId: string, event: RoomEvent): void {
  if (!isLiveUp()) return;
  try {
    void publisher.publish(`lastbell:room:${roomId}`, JSON.stringify(event));
  } catch {
    /* clients fall back to polling */
  }
}

export function subscribeRoom(roomId: string, callback: (roomEvent: RoomEvent) => void): () => void {
  let waiting = WAITERS.get(roomId);
  if (!waiting) {
    waiting = new Set();
    WAITERS.set(roomId, waiting);
  }
  waiting.add(callback);
  if (!SUBSCRIBED.has(roomId) && subscriber.status === 'ready') {
    SUBSCRIBED.add(roomId);
    subscriber.subscribe(`lastbell:room:${roomId}`).catch(() => {
      SUBSCRIBED.delete(roomId);
    });
  }
  return () => {
    const current = WAITERS.get(roomId);
    if (current) {
      current.delete(callback);
      if (current.size === 0) {
        WAITERS.delete(roomId);
        if (SUBSCRIBED.has(roomId)) {
          SUBSCRIBED.delete(roomId);
          if (subscriber.status === 'ready') {
            subscriber.unsubscribe(`lastbell:room:${roomId}`).catch(() => undefined);
          }
        }
      }
    }
  };
}

export async function readEvents(
  db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  roomId: string,
  after: number,
): Promise<RoomEvent[]> {
  const result = await db.query(
    'select id, type, data from events where room_id = $1 and id > $2 order by id asc limit 500',
    [roomId, after],
  );
  return (result.rows as Record<string, unknown>[]).map((row) => ({
    id: Number(row.id),
    type: String(row.type),
    data: row.data,
  }));
}

export async function writeLeaderboard(roomId: string, standings: Standing[], replace: boolean): Promise<void> {
  if (!isLiveUp()) return;
  const key = `lastbell:room:${roomId}:leaderboard`;
  if (replace) await publisher.del(key);
  if (standings.length === 0) return;
  await publisher.zadd(key, ...standings.flatMap((s) => [s.score, s.seatId]));
  await publisher.pexpire(key, 3600_000);
}

