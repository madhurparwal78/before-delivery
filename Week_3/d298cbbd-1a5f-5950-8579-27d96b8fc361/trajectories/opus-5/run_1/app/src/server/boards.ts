import { query } from './db.js';
import { LiveConnection } from './live.js';

export type BoardName = 'daily' | 'alltime';
export type BoardLength = '15' | '60';

export interface BoardRow {
  readonly rank: number;
  readonly name: string;
  readonly speed: number;
  readonly accuracy: number;
  readonly finishedAt: string;
}

interface BoardQueryRow {
  name: string;
  speed: string;
  accuracy: string;
  finished_at: Date;
}

/** Eligible runs: counted time tests of 15 or 60 seconds by verified typists, no punctuation or numbers. */
export async function boardRows(board: BoardName, length: BoardLength): Promise<BoardRow[]> {
  const daily = board === 'daily';
  const rows = await query<BoardQueryRow>(
    `select distinct on (t.id) t.name, r.speed, r.accuracy, r.finished_at
       from runs r join typists t on t.id = r.typist_id
      where r.verdict = 'counted' and t.verified = true and r.mode = 'time' and r.length = $1
        and r.punctuation = false and r.numbers = false
        and ($2 = false or r.finished_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC')
      order by t.id, r.speed desc, r.accuracy desc, r.finished_at asc`,
    [length, daily],
  );
  return rows
    .sort((a, b) => {
      const speed = Number(b.speed) - Number(a.speed);
      if (speed !== 0) return speed;
      const accuracy = Number(b.accuracy) - Number(a.accuracy);
      if (accuracy !== 0) return accuracy;
      return a.finished_at.getTime() - b.finished_at.getTime();
    })
    .slice(0, 50)
    .map((row, index) => ({
      rank: index + 1,
      name: row.name,
      speed: Number(row.speed),
      accuracy: Number(row.accuracy),
      finishedAt: row.finished_at.toISOString(),
    }));
}

interface Subscriber {
  readonly connection: LiveConnection;
  readonly board: BoardName;
  readonly length: BoardLength;
}

const subscribers = new Set<Subscriber>();

export function subscribeToBoard(
  connection: LiveConnection,
  board: BoardName,
  length: BoardLength,
): void {
  const subscriber: Subscriber = { connection, board, length };
  subscribers.add(subscriber);
  connection.onClose(() => subscribers.delete(subscriber));
}

export interface BoardChange {
  readonly name: string;
  readonly speed: number;
}

/** Pushes the board a counted eligible run belongs to, with the change to announce. */
export async function publishBoardChange(
  length: BoardLength,
  change: BoardChange,
): Promise<void> {
  for (const board of ['daily', 'alltime'] as const) {
    const listeners = [...subscribers].filter(
      (subscriber) => subscriber.board === board && subscriber.length === length,
    );
    if (listeners.length === 0) continue;
    const rows = await boardRows(board, length);
    const rank = rows.find((row) => row.name === change.name)?.rank ?? null;
    for (const listener of listeners) {
      listener.connection.send('board', {
        board,
        length,
        rows,
        change: rank === null ? null : { name: change.name, rank, speed: change.speed },
      });
    }
  }
}

async function publishDailyReset(): Promise<void> {
  for (const length of ['15', '60'] as const) {
    const listeners = [...subscribers].filter(
      (subscriber) => subscriber.board === 'daily' && subscriber.length === length,
    );
    if (listeners.length === 0) continue;
    const rows = await boardRows('daily', length);
    for (const listener of listeners) {
      listener.connection.send('board', { board: 'daily', length, rows, change: null });
    }
  }
}

function msUntilNextUtcMidnight(): number {
  const now = new Date();
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );
  return next - now.getTime();
}

/** Open daily boards show the new day within 3 seconds of 00:00 UTC. */
export function startDailyResetTimer(): void {
  const schedule = (): void => {
    const timer = setTimeout(() => {
      void publishDailyReset().catch(() => undefined);
      schedule();
    }, msUntilNextUtcMidnight() + 250);
    timer.unref();
  };
  schedule();
}
