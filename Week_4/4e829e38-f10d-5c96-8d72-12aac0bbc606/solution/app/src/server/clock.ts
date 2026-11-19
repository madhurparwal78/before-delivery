import type { Queryable } from "./db.js";

/**
 * The only place that reads or builds instants. The grading hook stores a fixed time in the
 * database; until it is first set, and when grading is off, the clock is real time.
 */
export async function now(db: Queryable): Promise<Date> {
  const { rows } = await db.query<{ now: Date }>("SELECT now FROM clock WHERE id = 1");
  return rows.length > 0 ? rows[0].now : new Date();
}

export function realNow(): Date {
  return new Date();
}

export const plus = (instant: Date, ms: number): Date => new Date(instant.getTime() + ms);

export const minuteStart = (instant: Date): Date => new Date(Math.floor(instant.getTime() / 60_000) * 60_000);

export const isoInstant = (value: Date): string => value.toISOString();

export function parseInstant(text: string): Date | null {
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const dateOf = (instant: Date): string => instant.toISOString().slice(0, 10);
