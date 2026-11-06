// The server's clock: every rule that depends on "now" reads it here.

import { kitchenDateOf } from "../shared/kitchenTime.js";

export function now(): number {
  return Date.now();
}

export function kitchenToday(at: number = now()): string {
  return kitchenDateOf(at);
}

export function iso(instant: number | Date): string {
  return new Date(instant).toISOString();
}
