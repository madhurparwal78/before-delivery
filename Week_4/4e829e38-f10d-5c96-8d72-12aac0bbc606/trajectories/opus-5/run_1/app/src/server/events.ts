import pg from 'pg';
import { config } from './config.js';
import { query } from './db.js';

export interface LiveEvent {
  type: string;
  teamId: string | null;
  [key: string]: unknown;
}

interface Subscriber {
  teams: Set<string>;
  personId: string;
  write: (event: LiveEvent) => void;
}

const subscribers = new Set<Subscriber>();
const CHANNEL = 'everyweek_events';

export function subscribe(sub: Subscriber): () => void {
  subscribers.add(sub);
  return () => subscribers.delete(sub);
}

function fanOut(event: LiveEvent): void {
  for (const sub of subscribers) {
    if (event.teamId === null || sub.teams.has(event.teamId)) sub.write(event);
  }
}

/**
 * Published from the same place the change is saved: the event row is written in
 * the database first, then every instance is notified and fans it out over SSE.
 */
export async function publish(event: LiveEvent): Promise<void> {
  const rows = await query<{ id: string }>(
    `INSERT INTO events (team_id, payload) VALUES ($1, $2) RETURNING id`,
    [event.teamId, JSON.stringify(event)],
  );
  await query(`SELECT pg_notify($1, $2)`, [CHANNEL, rows[0].id]);
}

let listener: pg.Client | null = null;

export async function startListening(): Promise<void> {
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  client.on('notification', (msg) => {
    if (msg.channel !== CHANNEL || !msg.payload) return;
    void query<{ payload: LiveEvent }>(`SELECT payload FROM events WHERE id = $1`, [
      msg.payload,
    ]).then((rows) => {
      if (rows.length === 1) fanOut(rows[0].payload);
    });
  });
  client.on('error', () => {
    listener = null;
    setTimeout(() => void startListening(), 1000);
  });
  await client.query(`LISTEN ${CHANNEL}`);
  listener = client;
}
