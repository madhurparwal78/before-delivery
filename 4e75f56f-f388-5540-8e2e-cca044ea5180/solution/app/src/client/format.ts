
// Display formatting only; money stays integer cents until it is printed here.

/** 345000 → "3,450.00" (the copy prints the dollar sign). */
export function dollars(cents: number): string {
  const whole = Math.trunc(cents / 100);
  return `${whole.toLocaleString("en-US")}.${String(Math.abs(cents % 100)).padStart(2, "0")}`;
}

export function mmss(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function hhmmss(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export const TIER_NAME = { bench: "Bench", atelier: "Atelier" } as const;

const STATE_LABEL: Record<string, string> = {
  held: "Held",
  deposit_paid: "Deposit paid",
  paid_in_full: "Paid in full",
  checked_in_day1: "Checked in, day 1",
  checked_in_day2: "Checked in, both days",
  certificate_issued: "Certificate issued",
  released: "Released",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

/** The state label, with "Balance overdue" for an unpaid balance once the server reports deposits closed. */
export function stateLabel(state: string, depositsOpen: boolean): string {
  return state === "deposit_paid" && !depositsOpen ? "Balance overdue" : (STATE_LABEL[state] ?? state);
}

export const LICENCE_LABEL: Record<string, string> = {
  none: "No licence yet",
  submitted: "Licence submitted",
  matched: "Licence matched",
  rejected: "Licence rejected",
};
