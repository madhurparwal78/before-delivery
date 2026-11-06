import type { Database } from './pool.js';
import { conflict, unavailable } from '../http/errors.js';
import { DB_NOW } from './sql.js';
import { isUniqueViolation } from './pool.js';
import type { GuessRow, Leader } from '../domain/leaderboard.js';
import { rankGuesses } from '../domain/leaderboard.js';

export type ContestStatus = 'open' | 'closed' | 'revealed';

export interface ContestState {
  readonly status: ContestStatus;
  readonly closesAt: string;
  readonly guessCount: number;
  readonly myGuess: { readonly value: number; readonly createdAt: Date } | null;
  readonly finalFigure: number | null;
  readonly revealedAt: Date | null;
  readonly leaderboard: readonly Leader[];
}

export class Contest {
  constructor(
    private readonly database: Database,
    private readonly closesAt: string,
  ) {}

  async state(account: number | null): Promise<ContestState> {
    const stored = await this.database.query<{
      final_figure: number | null;
      revealed_at: Date | null;
      guess_count: number;
      closed: boolean;
    }>(
      `SELECT c.final_figure, c.revealed_at,
              (SELECT count(*)::int FROM guesses) AS guess_count,
              now() >= $1::timestamptz AS closed
         FROM contest c WHERE c.id = 1`,
      [this.closesAt],
    );
    const row = stored.rows[0];
    if (row === undefined) throw unavailable();
    const status: ContestStatus =
      row.revealed_at !== null ? 'revealed' : row.closed ? 'closed' : 'open';
    const mine =
      account === null
        ? null
        : (
            await this.database.query<{ value: number; created_at: Date }>(
              'SELECT value, created_at FROM guesses WHERE account_id = $1',
              [account],
            )
          ).rows[0] ?? null;
    return {
      status,
      closesAt: this.closesAt,
      guessCount: row.guess_count,
      myGuess: mine === null ? null : { value: mine.value, createdAt: mine.created_at },
      finalFigure: row.final_figure,
      revealedAt: row.revealed_at,
      leaderboard: row.final_figure === null ? [] : await this.leaderboard(row.final_figure),
    };
  }

  private async leaderboard(finalFigure: number): Promise<Leader[]> {
    const result = await this.database.query<GuessRow & { created_at: Date }>(
      `SELECT g.id, a.name, g.value, g.created_at FROM guesses g JOIN accounts a ON a.id = g.account_id`,
    );
    return rankGuesses(
      result.rows.map((row) => ({ id: row.id, name: row.name, value: row.value, createdAt: row.created_at })),
      finalFigure,
    );
  }

  /** Accepted only while the clock reading taken for the decision is before the cut-off. */
  async submitGuess(account: number, value: number): Promise<{ value: number; createdAt: Date }> {
    return this.database.transaction(async (tx) => {
      const gate = await tx.query<{ open: boolean }>(
        `SELECT (now() < $1::timestamptz AND c.revealed_at IS NULL) AS open FROM contest c WHERE c.id = 1 FOR UPDATE`,
        [this.closesAt],
      );
      if (gate.rows[0]?.open !== true) throw conflict('contest_closed');
      try {
        const inserted = await tx.query<{ value: number; created_at: Date }>(
          `INSERT INTO guesses (account_id, value, created_at) VALUES ($1, $2, ${DB_NOW})
           RETURNING value, created_at`,
          [account, value],
        );
        const row = inserted.rows[0];
        if (row === undefined) throw unavailable();
        return { value: row.value, createdAt: row.created_at };
      } catch (error) {
        if (isUniqueViolation(error)) throw conflict('already_guessed');
        throw error;
      }
    });
  }

  async reveal(finalFigure: number): Promise<ContestState> {
    await this.database.transaction(async (tx) => {
      const current = await tx.query<{ revealed_at: Date | null }>(
        'SELECT revealed_at FROM contest WHERE id = 1 FOR UPDATE',
      );
      if (current.rows[0]?.revealed_at != null) throw conflict('already_revealed');
      // Every counted guess must read as earlier than the reveal, even when
      // two database clock readings fall inside the same millisecond.
      await tx.query(
        `UPDATE contest SET final_figure = $1,
                revealed_at = GREATEST(
                  ${DB_NOW},
                  COALESCE((SELECT max(created_at) FROM guesses), '-infinity'::timestamptz)
                    + interval '1 millisecond')
          WHERE id = 1`,
        [finalFigure],
      );
    });
    return this.state(null);
  }
}
