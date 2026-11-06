import type { Sql } from "./db.js";
import { isoInstant } from "../shared/time.js";

// The server clock is real time plus any offset set through PUT /api/clock.
// The offset lives in the database, so every instance sharing the database
// agrees, and all server-side time decisions use it.
export async function clockOffsetMs(sql: Sql): Promise<number> {
  const rows = await sql`SELECT offset_ms FROM clock_offsets WHERE id = 1`;
  if (rows.length === 0) return 0;
  return Number(rows[0].offset_ms);
}

export async function setClockOffset(sql: Sql, offsetMs: number): Promise<void> {
  await sql`
    INSERT INTO clock_offsets (id, offset_ms, seeded_at) VALUES (1, ${offsetMs}, now())
    ON CONFLICT (id) DO UPDATE SET offset_ms = ${offsetMs}
  `;
}

export class Clock {
  private offsetMs: number;

  private constructor(offsetMs: number) {
    this.offsetMs = offsetMs;
  }

  static async load(sql: Sql): Promise<Clock> {
    const offset = await clockOffsetMs(sql).catch(() => 0);
    return new Clock(offset);
  }

  // Used when the database is unreachable at boot: no offset is known, so the
  // clock reads real time until the offset can be loaded again.
  static fallback(): Clock {
    return new Clock(0);
  }

  now(): number {
    // The offset is a fixed offset from real time, so it survives re-reads.
    return Date.now() + this.offsetMs;
  }

  async refresh(sql: Sql): Promise<void> {
    try {
      this.offsetMs = await clockOffsetMs(sql);
    } catch {
      // Database unreachable: keep serving with the last known offset.
    }
  }

  iso(): string {
    return isoInstant(this.now());
  }
}

export const START_CLOCK_ISO = "2026-10-28T12:00:00Z";
export const START_CLOCK_MS = Date.parse(START_CLOCK_ISO);
