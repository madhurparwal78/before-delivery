import type { Db } from "./db.js";

/**
 * The server clock. Business time is real time plus a stored offset, so the
 * grading clock route can move it. Every business time comes from here.
 */
export class Clock {
  private offsetMs = 0;
  private db: Db | null = null;

  attachDb(db: Db): void {
    this.db = db;
    void this.load();
  }

  private async load(): Promise<void> {
    if (!this.db) return;
    try {
      const r = await this.db.query("SELECT v FROM kv WHERE k = 'clock_offset_ms'");
      if (r.rows[0]) this.offsetMs = Number(r.rows[0].v);
    } catch { /* not yet connected */ }
  }

  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }

  value(): number {
    return Date.now() + this.offsetMs;
  }

  async set(isoInstant: string): Promise<Date> {
    const t = new Date(isoInstant).getTime();
    this.offsetMs = t - Date.now();
    await this.store();
    return new Date(t);
  }

  async advance(ms: number): Promise<Date> {
    const target = this.now().getTime() + ms;
    this.offsetMs = target - Date.now();
    await this.store();
    return new Date(target);
  }

  private async store(): Promise<void> {
    if (!this.db) return;
    await this.db.query(
      "INSERT INTO kv (k, v) VALUES ('clock_offset_ms', $1) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v",
      [String(this.offsetMs)]
    );
  }
}

export const clock = new Clock();
