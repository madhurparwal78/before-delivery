/**
 * The in-process live channel. Every change is announced with `publish`, inside the transaction
 * that saved it, through postgres NOTIFY so instances sharing one database all hear it.
 */
import type { ServerResponse } from "node:http";
import pg from "pg";
import { config } from "./config.js";
import type { Queryable } from "./db.js";

const CHANNEL = "everyweek_events";

interface LiveEvent {
  /** What happened; pages decide what to refetch. */
  t: string;
  team?: string;
  project?: string;
  task?: string;
  /** When set, only this person's pages receive the event. */
  person?: string;
  [extra: string]: unknown;
}

interface Subscriber {
  res: ServerResponse;
  personId: string;
  teams: Set<string>;
}

const subscribers = new Set<Subscriber>();

export async function publish(db: Queryable, event: LiveEvent): Promise<void> {
  await db.query("SELECT pg_notify($1, $2)", [CHANNEL, JSON.stringify(event)]);
}

export function subscribe(res: ServerResponse, personId: string, teams: string[]): () => void {
  const subscriber: Subscriber = { res, personId, teams: new Set(teams) };
  subscribers.add(subscriber);
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write("retry: 1000\n\n: connected\n\n");
  return () => subscribers.delete(subscriber);
}

export function heartbeat(): void {
  for (const s of subscribers) s.res.write(": keep-alive\n\n");
}

function deliver(event: LiveEvent): void {
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const s of subscribers) {
    if (event.person ? event.person === s.personId : event.team ? s.teams.has(event.team) : false) s.res.write(frame);
  }
}

export async function listen(): Promise<void> {
  const client = new pg.Client({ connectionString: config.databaseUrl });
  const retry = () => setTimeout(() => void listen(), 1000);
  client.on("error", () => retry());
  client.on("end", () => retry());
  client.on("notification", (message) => {
    if (message.payload) deliver(JSON.parse(message.payload) as LiveEvent);
  });
  try {
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
  } catch {
    retry();
  }
}
