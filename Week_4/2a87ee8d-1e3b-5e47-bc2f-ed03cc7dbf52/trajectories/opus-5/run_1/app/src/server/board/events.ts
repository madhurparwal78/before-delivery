import pg from 'pg';
import { config } from '../config.js';
import { pool, type Queryable } from '../db/pool.js';

const BOARD_CHANNEL = 'lanternfold_board';
const PRESENCE_CHANNEL = 'lanternfold_presence';
const ENDED_CHANNEL = 'lanternfold_ended';

export interface BoardChange {
  readonly workshopId: string;
  readonly version: number;
}

export interface PresenceUpdate {
  readonly workshopId: string;
  readonly cursorId: string;
  readonly hue: number;
  readonly x: number;
  readonly y: number;
  readonly name: string;
  /** The participant whose cursor this is, so nobody receives their own cursor. */
  readonly sourceParticipantId: string | null;
}

export interface SessionEnded {
  readonly workshopId: string;
  readonly participantIds: readonly string[];
}

type Listener<T> = (payload: T) => void;

class Fanout<T> {
  private readonly listeners = new Set<Listener<T>>();

  subscribe(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(payload: T): void {
    for (const listener of this.listeners) listener(payload);
  }
}

export const boardChanges = new Fanout<BoardChange>();
export const presenceUpdates = new Fanout<PresenceUpdate>();
export const sessionEndings = new Fanout<SessionEnded>();

async function startListening(): Promise<void> {
  const client = new pg.Client({ connectionString: config.databaseUrl });
  client.on('notification', (message) => {
    if (message.payload === undefined) return;
    const payload: unknown = JSON.parse(message.payload);
    switch (message.channel) {
      case BOARD_CHANNEL:
        boardChanges.emit(payload as BoardChange);
        break;
      case PRESENCE_CHANNEL:
        presenceUpdates.emit(payload as PresenceUpdate);
        break;
      case ENDED_CHANNEL:
        sessionEndings.emit(payload as SessionEnded);
        break;
    }
  });
  client.on('error', () => {
    void reconnectListener();
  });
  await client.connect();
  await client.query(`LISTEN ${BOARD_CHANNEL}`);
  await client.query(`LISTEN ${PRESENCE_CHANNEL}`);
  await client.query(`LISTEN ${ENDED_CHANNEL}`);
}

async function reconnectListener(): Promise<void> {
  for (;;) {
    try {
      await startListening();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

export async function startEventBus(): Promise<void> {
  await reconnectListener();
}

async function notify(executor: Queryable, channel: string, payload: unknown): Promise<void> {
  await executor.query('SELECT pg_notify($1, $2)', [channel, JSON.stringify(payload)]);
}

/** Announces a committed board change to every instance. Sent inside the committing transaction. */
export async function publishBoardChange(executor: Queryable, change: BoardChange): Promise<void> {
  await notify(executor, BOARD_CHANNEL, change);
}

export async function publishPresence(update: PresenceUpdate): Promise<void> {
  await notify(pool, PRESENCE_CHANNEL, update);
}

export async function publishSessionEnded(executor: Queryable, ended: SessionEnded): Promise<void> {
  await notify(executor, ENDED_CHANNEL, ended);
}

/**
 * Safety net for a dropped notification: every open board is polled for its current version
 * so a change still reaches it inside the live-update delay.
 */
export function startVersionPoll(openWorkshopIds: () => readonly string[]): () => void {
  const timer = setInterval(() => {
    const ids = openWorkshopIds();
    if (ids.length === 0) return;
    void pool
      .query<{ id: string; version: number }>(
        'SELECT id, version FROM workshops WHERE id = ANY($1::text[])',
        [[...new Set(ids)]],
      )
      .then((result) => {
        for (const row of result.rows) {
          boardChanges.emit({ workshopId: row.id, version: row.version });
        }
      })
      .catch(() => undefined);
  }, 1_000);
  timer.unref();
  return () => clearInterval(timer);
}
