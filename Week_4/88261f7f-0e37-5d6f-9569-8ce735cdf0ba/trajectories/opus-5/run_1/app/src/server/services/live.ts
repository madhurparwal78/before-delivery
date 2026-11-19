import { Client } from 'pg';
import { config } from '../config';
import { Db, pool } from '../db';
import { PlainDate } from '../../shared/dates';
import { Role } from '../domain/roles';

const LIVE_CHANNEL = 'nightroll_live';

export type ChangeType = 'stay' | 'room' | 'close' | 'checkin' | 'merge' | 'report';

/** The allow-list of fields owner and front desk screens receive. */
export interface StaffChange {
  type: ChangeType;
  notice: string | null;
  stayId?: string;
  roomId?: string;
  businessDate?: PlainDate;
}

/** The allow-list of fields a housekeeper receives: room, dates and status only. */
export interface HousekeeperChange {
  type: 'room';
  roomId: string;
  number: string;
  status: string;
  arrival: PlainDate | null;
  departure: PlainDate | null;
  notice: string | null;
}

interface Envelope {
  hotelId: string;
  staff: StaffChange;
  housekeeper: HousekeeperChange | null;
}

export interface LiveSubscriber {
  hotelId: string;
  role: Role;
  send: (payload: StaffChange | HousekeeperChange) => void;
}

const subscribers = new Set<LiveSubscriber>();

export function subscribe(subscriber: LiveSubscriber): () => void {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

function dispatch(envelope: Envelope): void {
  for (const subscriber of subscribers) {
    if (subscriber.hotelId !== envelope.hotelId) continue;
    if (subscriber.role === 'housekeeper') {
      if (envelope.housekeeper) subscriber.send(envelope.housekeeper);
      continue;
    }
    subscriber.send(envelope.staff);
  }
}

/**
 * Queues one change for the hotel's connected staff. Run on a transaction's client the
 * notification reaches every app instance only when that transaction commits.
 */
export async function publishChange(
  db: Db,
  hotelId: string,
  staff: StaffChange,
  housekeeper: HousekeeperChange | null = null,
): Promise<void> {
  const envelope: Envelope = { hotelId, staff, housekeeper };
  await db.query('select pg_notify($1, $2)', [LIVE_CHANNEL, JSON.stringify(envelope)]);
}

let listener: Client | null = null;

export async function startListening(): Promise<void> {
  const client = new Client({ connectionString: config.databaseUrl });
  listener = client;
  client.on('notification', (message) => {
    if (message.channel !== LIVE_CHANNEL || !message.payload) return;
    dispatch(JSON.parse(message.payload) as Envelope);
  });
  client.on('error', () => {
    listener = null;
    client.end().catch(() => undefined);
    setTimeout(() => {
      startListening().catch(() => undefined);
    }, 1000);
  });
  await client.connect();
  await client.query(`listen ${LIVE_CHANNEL}`);
}
