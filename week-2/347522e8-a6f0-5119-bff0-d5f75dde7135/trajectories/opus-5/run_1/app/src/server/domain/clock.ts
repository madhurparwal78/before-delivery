import { kitchenDate } from '../../shared/kitchenTime.js';

/** The server's clock is the only clock the rules consult. */
export function nowMs(): number {
  return Date.now();
}

/** "Today" everywhere in the app: the server's kitchen date. */
export function kitchenToday(): string {
  return kitchenDate(nowMs());
}

export function isoInstant(instantMs: number): string {
  return new Date(instantMs).toISOString();
}
