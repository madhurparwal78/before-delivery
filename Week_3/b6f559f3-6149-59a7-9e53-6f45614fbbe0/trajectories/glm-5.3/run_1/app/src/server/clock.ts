// Server clock: starts at APP_START_AT on reset, runs in real time, moves
// with the grading clock route. The offset lives in the database so every
// running copy agrees.
import type { Pool } from 'pg';

export class Clock {
  #offsetMs: number | null = null;
  #startAt: number;

  constructor(startAtIso: string) {
    this.#startAt = Date.parse(startAtIso);
    if (Number.isNaN(this.#startAt)) this.#startAt = Date.parse('2026-11-06T10:00:00Z');
  }

  async init(pool: Pool): Promise<void> {
    const res = await pool.query<{ value: string }>(
      `INSERT INTO app_meta (key, value) VALUES ('clock_offset', '0')
       ON CONFLICT (key) DO NOTHING
       RETURNING value`,
    );
    if (res.rows.length > 0) {
      this.#offsetMs = Number(res.rows[0]!.value);
      return;
    }
    const got = await pool.query<{ value: string }>(
      `SELECT value FROM app_meta WHERE key = 'clock_offset'`,
    );
    this.#offsetMs = Number(got.rows[0]?.value ?? 0);
  }

  async advance(pool: Pool, ms: number): Promise<string> {
    this.#offsetMs = (this.#offsetMs ?? 0) + ms;
    await pool.query(`UPDATE app_meta SET value = $1 WHERE key = 'clock_offset'`, [
      String(this.#offsetMs),
    ]);
    return this.nowIso();
  }

  async reset(pool: Pool): Promise<void> {
    this.#offsetMs = 0;
    await pool.query(
      `INSERT INTO app_meta (key, value) VALUES ('clock_offset', '0')
       ON CONFLICT (key) DO UPDATE SET value = '0'`,
    );
  }

  nowMs(): number {
    return Date.now() + (this.#offsetMs ?? 0);
  }

  nowIso(): string {
    return new Date(this.nowMs()).toISOString();
  }

  startIso(): string {
    return new Date(this.#startAt).toISOString();
  }
}
