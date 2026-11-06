// The ledger's accounts and balance rule, defined once, and the words each movement is shown with
// on My kitchen and on statements.

import type { MovementKind } from "./api.js";

export const MOVEMENT_WORDS: Record<MovementKind, string> = {
  opening_balance: "Opening balance",
  pack_purchase: "Pack purchase",
  booking_hold: "Booking hold",
  hold_release: "Hold released",
  cancellation_credit: "Cancellation credit",
  displacement_credit: "Displacement credit",
  checkout: "Check-out",
  cancellation_forfeit: "Cancellation forfeit",
  adjustment: "Adjustment",
};

export const availableAccount = (renterId: string): string => `renter:${renterId}:available`;
export const heldAccount = (renterId: string): string => `renter:${renterId}:held`;

interface Posting {
  account: string;
  direction: "debit" | "credit";
  minutes: number;
}

/** An entry's effect on its account: a credit adds its minutes, a debit takes them away. */
export function signedMinutes(entry: Posting): number {
  return entry.direction === "credit" ? entry.minutes : -entry.minutes;
}

/** The entries on `account`, oldest first, each with the account's balance after it. */
export function runningBalance<T extends Posting>(entries: readonly T[], account: string): { entry: T; balance: number }[] {
  let balance = 0;
  return entries
    .filter((entry) => entry.account === account)
    .map((entry) => {
      balance += signedMinutes(entry);
      return { entry, balance };
    });
}

/** An account's balance: the credits minus the debits of its entries. */
export function balanceOf(entries: readonly Posting[], account: string): number {
  return entries.reduce((sum, entry) => (entry.account === account ? sum + signedMinutes(entry) : sum), 0);
}
