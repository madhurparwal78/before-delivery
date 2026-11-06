// Every user-facing string the brief pins, in one place, shared by the server and the browser.

import { formatMoney } from "./money.js";

export type ErrorCode =
  | "unauthenticated"
  | "bad_credentials"
  | "forbidden"
  | "not_found"
  | "cross_origin"
  | "unsupported_media_type"
  | "body_too_large"
  | "validation"
  | "no_unit_free"
  | "unit_busy"
  | "hold_expired"
  | "borrowing_paused"
  | "borrowing_limit"
  | "renewal_used"
  | "invalid_transition"
  | "idempotency_conflict"
  | "request_in_progress"
  | "photo_limit"
  | "unsupported_photo"
  | "photo_too_large"
  | "not_settled"
  | "settlement_mismatch"
  | "billing_unavailable"
  | "photo_storage_unavailable"
  | "internal";

/** Copy for the codes whose message never varies. */
export const ERROR_COPY = {
  unauthenticated: "Sign in to continue.",
  bad_credentials: "Email or password is wrong.",
  forbidden: "Your role can't do that.",
  not_found: "Not found.",
  cross_origin: "Cross-site requests are refused.",
  unsupported_media_type: "Send JSON, or a multipart form for photos.",
  body_too_large: "Request body is too large.",
  validation: "Check the highlighted fields.",
  no_unit_free: "No unit is free for these dates.",
  unit_busy: "That unit is busy on some of those days.",
  hold_expired: "This hold's pickup window has closed.",
  borrowing_paused: "Borrowing is paused while an item is overdue.",
  borrowing_limit: "You can have at most 4 items held or out at once.",
  renewal_used: "This loan has already been renewed once.",
  idempotency_conflict: "That Idempotency-Key was used for a different request.",
  request_in_progress: "That request is still being processed.",
  photo_limit: "This stage already has 4 photos.",
  unsupported_photo: "Photos must be JPEG, PNG or WebP.",
  photo_too_large: "Photos can be at most 5,000,000 bytes.",
  not_settled: "This loan isn't settled yet.",
  photo_storage_unavailable: "Photo storage is offline. The loan is saved; add photos when it's back.",
  internal: "Something went wrong on our side. Try again.",
} as const satisfies Partial<Record<ErrorCode, string>>;

export const BILLING_OFFLINE_LEND =
  "Billing is offline, so items with a deposit can't be lent right now. Items without a deposit still lend.";
export const BILLING_OFFLINE_SETTLE =
  "Billing is offline, so this loan can't be settled yet. Try again with the same damage charge once billing is back.";

export function invalidTransitionCopy(kind: "hold" | "loan", status: string): string {
  return `This ${kind} is ${status.toLowerCase()} and can't do that.`;
}

export function settlementMismatchCopy(fixedDamageCents: number): string {
  return `An earlier attempt fixed this loan's damage charge at ${formatMoney(fixedDamageCents)}. Settle again with that amount.`;
}

export const FIELD_COPY = {
  start_date: "Choose an open day from today, within the next 28 days.",
  end_date: "Choose an open day on or after pickup, at most 7 days later.",
  due_date_walk_in: "Choose an open day on or after checkout, at most 7 days later.",
  due_date_renewal: "Choose an open day after the current due date, at most 7 days later.",
  checked_out_at: "Checkout time can't be in the future.",
  returned_at: "Return time must be after checkout and not in the future.",
  outcome: "Choose OK or Damaged.",
  note_damaged: "Describe the damage in up to 500 characters.",
  note_ok: "Notes can be up to 500 characters.",
  damage_ok: "An item inspected OK has no damage charge.",
  damage: "Damage charge must be whole cents from $0.00 to the item's replacement value.",
  idempotency_key: "Send an Idempotency-Key header of 1 to 100 characters.",
  limit: "Choose a page size from 1 to 50.",
  cursor: "This page link is out of date. Start from the first page.",
  from: "Choose a date as YYYY-MM-DD.",
  required: "Required.",
} as const;

export function noSuchCopy(what: "item" | "member" | "unit" | "hold"): string {
  return `No such ${what}.`;
}

export const SERVICE_BANNER = {
  billing: "Billing offline — deposit items are blocked. Items without a deposit still lend.",
  photoStorage: "Photo storage offline — add photos later.",
} as const;

export const BLOCKED_ROW = "Blocked: billing offline";
export const PHOTO_UNAVAILABLE = "Photo unavailable";

export const HOLD_STATUS_WORD = {
  requested: "Requested",
  ready: "Ready",
  collected: "Collected",
  expired: "Expired",
  cancelled: "Cancelled",
} as const;

export const LOAN_STATUS_WORD = {
  out: "Out",
  overdue: "Overdue",
  returned: "Returned",
  inspected: "Inspected",
  settled: "Settled",
} as const;

export const SPAN_STATUS_WORD = { held: "Held", out: "Out", overdue: "Overdue" } as const;

export const LEDGER_KIND_WORD = {
  deposit_hold: "Deposit hold",
  deposit_release: "Deposit release",
  damage_charge: "Damage charge",
  extra_damage: "Extra damage",
  late_fee: "Late fee",
} as const;

export interface ReceiptFigures {
  deposit_cents: number;
  released_cents: number;
  damage_cents: number;
  extra_damage_cents: number;
  late_fee_cents: number;
  late_days: number;
  total_charged_cents: number;
}

/** The six receipt lines shared by the receipt email and the Receipt region. */
export function receiptLines(s: ReceiptFigures): string[] {
  return [
    `Deposit held: ${formatMoney(s.deposit_cents)}`,
    `Deposit released: ${formatMoney(s.released_cents)}`,
    `Damage charge: ${formatMoney(s.damage_cents)}`,
    `Charged beyond deposit: ${formatMoney(s.extra_damage_cents)}`,
    `Late fee: ${formatMoney(s.late_fee_cents)} (${s.late_days} late days)`,
    `Total charged: ${formatMoney(s.total_charged_cents)}`,
  ];
}
