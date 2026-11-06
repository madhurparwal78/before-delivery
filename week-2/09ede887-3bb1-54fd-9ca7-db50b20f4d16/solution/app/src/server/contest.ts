import { config } from './config';
import { transaction, type Db } from './db';
import { ApiError, invalidFields } from './errors';

// The Call the number contest. Its state is computed on every read from the stored reveal and
// PostgreSQL's clock; guesses and the reveal are ordered by a lock on the contest row.

export type ContestStatus = 'open' | 'closed' | 'revealed';

export interface GuessRecord {
  value: number;
  created_at: string;
}

export interface LeaderRecord {
  rank: number;
  display_name: string;
  value: number;
  distance: number;
}

export interface ContestView {
  status: ContestStatus;
  closes_at: string;
  guess_count: number;
  my_guess: GuessRecord | null;
  final_figure: number | null;
  revealed_at: string | null;
  leaderboard: LeaderRecord[];
}

function contestStatus(revealed: boolean, pastCutOff: boolean): ContestStatus {
  if (revealed) return 'revealed';
  return pastCutOff ? 'closed' : 'open';
}

// First word, then the first letter of the last word and a full stop: "Quinn H.".
function displayName(name: string): string {
  const words = name.trim().split(/\s+/);
  const first = words[0] ?? '';
  const last = words.at(-1) ?? '';
  return words.length < 2 ? first : `${first} ${Array.from(last)[0] ?? ''}.`;
}

export async function readContest(tx: Db, callerId: string | null): Promise<ContestView> {
  const state = await tx.query<{ final_figure: number | null; revealed_at: string | null; past: boolean; guess_count: number }>(
    `SELECT final_figure, iso(revealed_at) AS revealed_at, clock_timestamp() >= $1::timestamptz AS past,
            (SELECT count(*) FROM guesses)::int AS guess_count
       FROM contest`,
    [config.contestClosesAt],
  );
  const contest = state.rows[0] ?? { final_figure: null, revealed_at: null, past: false, guess_count: 0 };
  const mine = await tx.query<GuessRecord>('SELECT value, iso(created_at) AS created_at FROM guesses WHERE account_id = $1', [
    callerId,
  ]);
  // The leaderboard ranks by distance, then earlier guess, then lower guess id.
  const leaders =
    contest.final_figure === null
      ? []
      : (
          await tx.query<{ name: string; value: number; distance: number }>(
            `SELECT a.name, g.value, abs(g.value - $1::int) AS distance
               FROM guesses g JOIN accounts a ON a.id = g.account_id
              ORDER BY abs(g.value - $1::int), g.created_at, g.id
              LIMIT 3`,
            [contest.final_figure],
          )
        ).rows;
  return {
    status: contestStatus(contest.revealed_at !== null, contest.past),
    closes_at: config.contestClosesAt.toISOString().replace('.000Z', 'Z'),
    guess_count: contest.guess_count,
    my_guess: mine.rows[0] ?? null,
    final_figure: contest.final_figure,
    revealed_at: contest.revealed_at,
    leaderboard: leaders.map((row, index) => ({
      rank: index + 1,
      display_name: displayName(row.name),
      value: row.value,
      distance: row.distance,
    })),
  };
}

function wholeNumber(body: unknown, name: string): number {
  const value = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[name] : undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100_000_000) {
    throw invalidFields({ [name]: 'Enter a whole number from 1 to 100,000,000.' });
  }
  return value;
}

export function guessFrom(body: unknown): number {
  return wholeNumber(body, 'value');
}

export function figureFrom(body: unknown): number {
  return wholeNumber(body, 'final_figure');
}

// A guess is accepted only while the clock reading taken under the contest lock is before the
// cut-off and nothing is revealed; that reading becomes its created_at.
export async function submitGuess(accountId: string, value: number): Promise<GuessRecord> {
  return transaction(async (tx) => {
    await tx.query('SELECT 1 FROM contest FOR UPDATE');
    const decision = await tx.query<{ now: string; accepting: boolean }>(
      `WITH clock AS (SELECT clock_timestamp() AS now)
       SELECT now::text AS now, (SELECT revealed_at IS NULL FROM contest) AND now < $1::timestamptz AS accepting
         FROM clock`,
      [config.contestClosesAt],
    );
    const reading = decision.rows[0];
    if (reading?.accepting !== true) throw new ApiError('contest_closed');
    const stored = await tx.query<GuessRecord>(
      `INSERT INTO guesses (account_id, value, created_at) VALUES ($1, $2, $3::timestamptz)
       ON CONFLICT (account_id) DO NOTHING RETURNING value, iso(created_at) AS created_at`,
      [accountId, value, reading.now],
    );
    const guess = stored.rows[0];
    if (guess === undefined) throw new ApiError('already_guessed');
    return guess;
  });
}

export async function revealResult(finalFigure: number): Promise<ContestView> {
  return transaction(async (tx) => {
    const locked = await tx.query<{ revealed: boolean }>('SELECT revealed_at IS NOT NULL AS revealed FROM contest FOR UPDATE');
    if (locked.rows[0]?.revealed !== false) throw new ApiError('already_revealed');
    await tx.query('UPDATE contest SET final_figure = $1, revealed_at = clock_timestamp()', [finalFigure]);
    return readContest(tx, null);
  });
}
