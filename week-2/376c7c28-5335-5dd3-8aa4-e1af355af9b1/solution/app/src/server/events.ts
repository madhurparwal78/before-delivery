import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { config } from './config.ts';
import type { Queryable } from './db/pool.ts';

export type EventKind =
  | 'piece'
  | 'load'
  | 'charge'
  | 'credit'
  | 'invite'
  | 'rates'
  | 'studio'
  | 'member'
  | 'month'
  | 'session';

export interface ChangeEvent {
  readonly kind: EventKind;
  readonly id: string;
  readonly studio_id: string;
  /** The member whose own record changed, when the change is not studio-wide. */
  readonly member_id?: string | null;
  /** A single session the message is meant for. */
  readonly session_id?: string | null;
}

interface Subscriber {
  readonly studioId: string;
  readonly personId: string;
  readonly sessionId: string;
  readonly isStaff: boolean;
  readonly deliver: (seq: number, event: ChangeEvent) => void;
}

const CHANNEL = 'kd_events';
const STUDIO_WIDE_FOR_MEMBERS: readonly EventKind[] = ['rates', 'studio'];

const subscribers = new Set<Subscriber>();

/** Recent changes this instance fanned out, so a stream that opens late or reconnects misses none. */
const EPOCH = randomUUID().slice(0, 8);
const REPLAY_MS = 60_000;
let sequence = 0;
const recent: { readonly seq: number; readonly at: number; readonly event: ChangeEvent }[] = [];

/** The position of the latest change, as `<epoch>.<seq>`; sent on every API answer. */
export function cursor(): string {
  return `${EPOCH}.${sequence}`;
}

/** Delivers the changes after `after` (a cursor) that the subscriber may read. */
export function replay(subscriber: Subscriber, after: string | null, deliver: (seq: number, event: ChangeEvent) => void): void {
  const [epoch, seq] = (after ?? '').split('.');
  const from = Number(seq);
  if (epoch !== EPOCH || !Number.isInteger(from)) return;
  for (const entry of recent) {
    if (entry.seq > from && mayRead(subscriber, entry.event)) deliver(entry.seq, entry.event);
  }
}

export function eventId(seq: number): string {
  return `${EPOCH}.${seq}`;
}

export function subscribe(subscriber: Subscriber): () => void {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

function mayRead(subscriber: Subscriber, event: ChangeEvent): boolean {
  if (subscriber.studioId !== event.studio_id) return false;
  if (event.kind === 'session') {
    if (event.session_id) return subscriber.sessionId === event.session_id;
    return subscriber.personId === (event.member_id ?? '');
  }
  if (subscriber.isStaff) return true;
  if (event.member_id) return event.member_id === subscriber.personId;
  return STUDIO_WIDE_FOR_MEMBERS.includes(event.kind);
}

function fanOut(event: ChangeEvent): void {
  sequence += 1;
  const now = Date.now();
  recent.push({ seq: sequence, at: now, event });
  while (recent.length > 0 && now - recent[0]!.at > REPLAY_MS) recent.shift();
  for (const subscriber of subscribers) {
    if (mayRead(subscriber, event)) subscriber.deliver(sequence, event);
  }
}

/** Publishes a change so every instance's open screens follow it. */
export async function publish(client: Queryable, event: ChangeEvent): Promise<void> {
  await client.query('select pg_notify($1, $2)', [CHANNEL, JSON.stringify(event)]);
}

let listener: pg.Client | null = null;

export async function startListening(): Promise<void> {
  const connect = async (): Promise<void> => {
    const client = new pg.Client({ connectionString: config.databaseUrl });
    client.on('notification', (message) => {
      if (message.channel !== CHANNEL || !message.payload) return;
      try {
        fanOut(JSON.parse(message.payload) as ChangeEvent);
      } catch {
        /* a payload the app cannot read is dropped */
      }
    });
    client.on('error', () => {
      listener = null;
      setTimeout(() => void connect().catch(() => undefined), 1_000);
    });
    await client.connect();
    await client.query(`listen ${CHANNEL}`);
    listener = client;
  };
  await connect().catch(() => {
    setTimeout(() => void startListening().catch(() => undefined), 2_000);
  });
}
