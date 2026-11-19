import { type Db, query } from './db';

export const OWNER_TOPIC = 'owner';

export function performanceTopic(performanceId: string): string {
  return `performance:${performanceId}`;
}

export function buyerTopic(buyerId: string): string {
  return `buyer:${buyerId}`;
}

export function offerTopic(token: string): string {
  return `offer:${token}`;
}

/** Marks what changed so that open pages of other copies of the server learn about it. */
export async function recordChange(db: Db, topics: readonly string[]): Promise<void> {
  const unique = [...new Set([...topics, OWNER_TOPIC])];
  await db.query(`insert into change_feed (topic) select unnest($1::text[])`, [unique]);
}

export interface LiveSubscriber {
  readonly topics: ReadonlySet<string>;
  readonly notify: () => void;
}

const subscribers = new Set<LiveSubscriber>();
let lastSeenId = 0;

export function subscribe(subscriber: LiveSubscriber): () => void {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

async function pollChangeFeed(): Promise<void> {
  const changed = await query<{ topic: string; id: string }>(
    `select topic, max(id) as id from change_feed where id > $1 group by topic`,
    [lastSeenId],
  );
  if (changed.length === 0) return;
  lastSeenId = changed.reduce((highest, row) => Math.max(highest, Number(row.id)), lastSeenId);
  const topics = new Set(changed.map((row) => row.topic));
  for (const subscriber of subscribers) {
    for (const topic of subscriber.topics) {
      if (topics.has(topic)) {
        subscriber.notify();
        break;
      }
    }
  }
}

export async function startLiveUpdates(): Promise<void> {
  const latest = await query<{ id: string | null }>(`select max(id) as id from change_feed`);
  lastSeenId = Number(latest[0]?.id ?? 0);
  setInterval(() => {
    void pollChangeFeed().catch(() => undefined);
  }, 400).unref();
  setInterval(() => {
    void query(`delete from change_feed where created_at < now() - interval '2 minutes'`).catch(() => undefined);
  }, 60_000).unref();
}
