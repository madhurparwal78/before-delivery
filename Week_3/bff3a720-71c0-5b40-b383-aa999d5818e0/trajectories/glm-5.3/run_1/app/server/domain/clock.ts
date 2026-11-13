import pg from 'pg';

/**
 * The one server clock. "Now" is wall time plus the grading offset kept in PostgreSQL,
 * so every app instance on the same database agrees on time.
 */

export class Clock {
  #offsetMs = 0;
  #db: pg.Pool | null = null;
  #loadPromise: Promise<void> | null = null;

  attach(db: pg.Pool): void {
    this.#db = db;
  }

  nowMs(): number {
    return Date.now() + this.#offsetMs;
  }

  offsetMs(): number {
    return this.#offsetMs;
  }

  async load(): Promise<void> {
    this.#loadPromise ??= this.#doLoad();
    await this.#loadPromise;
  }

  async #doLoad(): Promise<void> {
    const db = this.#db;
    if (!db) return;
    try {
      const r = await db.query('SELECT offset_ms FROM clock_offset WHERE id = 1');
      this.#offsetMs = r.rows.length > 0 ? Number(r.rows[0].offset_ms) : 0;
    } catch {
      // Schema may not exist yet at first boot; the next sweep reloads it.
      this.#offsetMs = 0;
    }
  }

  /** Advances the shared offset. Never goes backwards. */
  async advance(seconds: number): Promise<number> {
    const db = this.#db;
    if (!db) throw new Error('clock not attached');
    const r = await db.query(
      'UPDATE clock_offset SET offset_ms = offset_ms + $1 WHERE id = 1 RETURNING offset_ms',
      [Math.max(0, Math.round(seconds)) * 1000],
    );
    this.#offsetMs = Number(r.rows[0].offset_ms);
    return this.#offsetMs;
  }

  async reload(): Promise<void> {
    this.#loadPromise = null;
    await this.load();
  }
}
