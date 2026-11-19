import { AsyncLocalStorage } from 'node:async_hooks';
import { db, transaction } from './db.ts';

// The server clock is real time plus one stored offset (brief: The server clock).
let offsetMs = 0;
const pinned = new AsyncLocalStorage<Date>();

export async function loadClock(): Promise<void> {
  const rows = await db.q<{ offset_ms: number }>('SELECT offset_ms FROM server_clock WHERE id = 1');
  offsetMs = rows[0]?.offset_ms ?? 0;
}

/** Server-clock time; inside `at` it is the instant the timer being processed was due. */
export function now(): Date {
  return pinned.getStore() ?? new Date(Date.now() + offsetMs);
}

export function at<T>(when: Date, work: () => Promise<T>): Promise<T> {
  return pinned.run(when, work);
}

/** Whole seconds, as every stored and published server time is. */
export function wholeSecond(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 1000) * 1000);
}

export const iso = (date: Date): string => wholeSecond(date).toISOString().replace('.000Z', 'Z');

export async function advanceClock(seconds: number): Promise<number> {
  const total = await transaction(async (tx) => {
    const rows = await tx.q<{ offset_ms: number }>('UPDATE server_clock SET offset_ms = offset_ms + $1 WHERE id = 1 RETURNING offset_ms', [
      seconds * 1000,
    ]);
    return rows[0].offset_ms;
  });
  offsetMs = total;
  return total / 1000;
}

/** The time grading and API answers show: rounded up so an advance never lands early. */
export function shownNow(): string {
  const date = now();
  return new Date(Math.ceil(date.getTime() / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}
