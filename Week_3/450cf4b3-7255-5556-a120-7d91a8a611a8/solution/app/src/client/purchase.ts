// Purchase attempts. An attempt is the Idempotency-Key and pack size of one press; while it is open
// (a failed press), the next press of the same button resends it. The open attempt lives in the tab's
// sessionStorage under the signed-in user's id, so it survives a reload and nobody else's sign-in sees it.

import type { PackHours } from "../shared/api.js";
import { PACK_HOURS } from "../shared/api.js";

export interface PurchaseAttempt {
  hours: PackHours;
  key: string;
}

const PREFIX = "stationhouse.purchase.";

/** The attempt whose request has not settled; further presses send nothing. Cleared at every change of user. */
let sending: PurchaseAttempt | null = null;

export const sendingAttempt = (): PurchaseAttempt | null => sending;
export const markSending = (attempt: PurchaseAttempt | null): void => {
  sending = attempt;
};

export function openAttempt(userId: string): PurchaseAttempt | null {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(PREFIX + userId) ?? "null");
    if (typeof parsed !== "object" || parsed === null || !("hours" in parsed) || !("key" in parsed)) return null;
    const hours = PACK_HOURS.find((h) => h === parsed.hours);
    return hours !== undefined && typeof parsed.key === "string" ? { hours, key: parsed.key } : null;
  } catch {
    return null;
  }
}

export function keepAttempt(userId: string, attempt: PurchaseAttempt): void {
  sessionStorage.setItem(PREFIX + userId, JSON.stringify(attempt));
}

export function closeAttempt(userId: string): void {
  sessionStorage.removeItem(PREFIX + userId);
}

/** Sign out (null) or a sign-in as `userId` discards every other user's open attempt; a 401 discards none. */
export function discardAttemptsExcept(userId: string | null): void {
  sending = null;
  for (const name of Object.keys(sessionStorage)) {
    if (name.startsWith(PREFIX) && name !== PREFIX + userId) sessionStorage.removeItem(name);
  }
}
