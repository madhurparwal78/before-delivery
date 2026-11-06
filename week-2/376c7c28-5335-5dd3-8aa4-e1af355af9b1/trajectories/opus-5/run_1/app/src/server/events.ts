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

export interface Subscriber {
  readonly studioId: string;
  readonly personId: string;
  readonly sessionId: string;
  readonly isStaff: boolean;
  readonly deliver: (event: ChangeEvent) => void;
}

const CHANNEL = 'kd_events';
const STUDIO_WIDE_FOR_MEMBERS: readonly EventKind[] = ['rates', 'studio'];

const subscribers = new Set<Subscriber>();

export function subscribe(subscriber: Subscriber): () => void {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

export function mayRead(subscriber: Subscriber, event: ChangeEvent): boolean {
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
  for (const subscriber of subscribers) {
    if (mayRead(subscriber, event)) subscriber.deliver(event);
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
