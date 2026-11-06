/** The one error shape, the one set of codes and the one set of copy. */

export type ErrorCode =
  | 'unauthenticated'
  | 'bad_credentials'
  | 'forbidden'
  | 'not_found'
  | 'cross_origin'
  | 'unsupported_media_type'
  | 'body_too_large'
  | 'validation'
  | 'no_unit_free'
  | 'unit_busy'
  | 'hold_expired'
  | 'borrowing_paused'
  | 'borrowing_limit'
  | 'renewal_used'
  | 'invalid_transition'
  | 'idempotency_conflict'
  | 'request_in_progress'
  | 'photo_limit'
  | 'unsupported_photo'
  | 'photo_too_large'
  | 'not_settled'
  | 'settlement_mismatch'
  | 'billing_unavailable'
  | 'photo_storage_unavailable';

export const ERROR_COPY: Record<Exclude<ErrorCode, 'invalid_transition' | 'settlement_mismatch' | 'billing_unavailable'>, string> = {
  unauthenticated: 'Sign in to continue.',
  bad_credentials: 'Email or password is wrong.',
  forbidden: "Your role can't do that.",
  not_found: 'Not found.',
  cross_origin: 'Cross-site requests are refused.',
  unsupported_media_type: 'Send JSON, or a multipart form for photos.',
  body_too_large: 'Request body is too large.',
  validation: 'Check the highlighted fields.',
  no_unit_free: 'No unit is free for these dates.',
  unit_busy: 'That unit is busy on some of those days.',
  hold_expired: "This hold's pickup window has closed.",
  borrowing_paused: 'Borrowing is paused while an item is overdue.',
  borrowing_limit: 'You can have at most 4 items held or out at once.',
  renewal_used: 'This loan has already been renewed once.',
  idempotency_conflict: 'That Idempotency-Key was used for a different request.',
  request_in_progress: 'That request is still being processed.',
  photo_limit: 'This stage already has 4 photos.',
  unsupported_photo: 'Photos must be JPEG, PNG or WebP.',
  photo_too_large: 'Photos can be at most 5,000,000 bytes.',
  not_settled: "This loan isn't settled yet.",
  photo_storage_unavailable: 'Photo storage is offline. The loan is saved; add photos when it\u2019s back.',
};

export const BILLING_UNAVAILABLE_LENDING =
  "Billing is offline, so items with a deposit can't be lent right now. Items without a deposit still lend.";

export const BILLING_UNAVAILABLE_SETTLEMENT =
  "Billing is offline, so this loan can't be settled yet. Try again with the same damage charge once billing is back.";

export function invalidTransitionCopy(subject: 'hold' | 'loan', statusWord: string): string {
  return `This ${subject} is ${statusWord.toLowerCase()} and can't do that.`;
}

export function settlementMismatchCopy(money: string): string {
  return `An earlier attempt fixed this loan's damage charge at ${money}. Settle again with that amount.`;
}

export const FIELD_COPY = {
  start_date: 'Choose an open day from today, within the next 28 days.',
  end_date: 'Choose an open day on or after pickup, at most 7 days later.',
  due_date_walk_in: 'Choose an open day on or after checkout, at most 7 days later.',
  due_date_renewal: 'Choose an open day after the current due date, at most 7 days later.',
  checked_out_at: "Checkout time can't be in the future.",
  returned_at: 'Return time must be after checkout and not in the future.',
  outcome: 'Choose OK or Damaged.',
  note_damage: 'Describe the damage in up to 500 characters.',
  note_ok: 'Notes can be up to 500 characters.',
  damage_ok: 'An item inspected OK has no damage charge.',
  damage_range: "Damage charge must be whole cents from $0.00 to the item's replacement value.",
  idempotency_key: 'Send an Idempotency-Key header of 1 to 100 characters.',
  limit: 'Choose a page size from 1 to 50.',
  cursor: 'This page link is out of date. Start from the first page.',
  required: 'Required.',
} as const;

export function noSuchCopy(kind: 'item' | 'member' | 'unit' | 'hold'): string {
  return `No such ${kind}.`;
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    fields?: Record<string, string>;
  };
}
