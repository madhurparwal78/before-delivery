import type { Args } from '../../shared/strings.ts';

export type ErrorCode =
  | 'invalid_json'
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'forbidden'
  | 'cross_origin'
  | 'members_priority'
  | 'stepup_required'
  | 'not_found'
  | 'method_not_allowed'
  | 'idempotency_in_progress'
  | 'seat_taken'
  | 'not_on_sale'
  | 'screening_closed'
  | 'hold_already_paid'
  | 'booking_not_paid'
  | 'already_refunded'
  | 'booking_checked_in'
  | 'refund_window_closed'
  | 'already_checked_in'
  | 'checkin_not_open'
  | 'checkin_closed'
  | 'ticket_refunded'
  | 'already_member'
  | 'not_member'
  | 'no_change'
  | 'change_pending'
  | 'gift_membership_locked'
  | 'illegal_transition'
  | 'season_has_future_screenings'
  | 'season_closed'
  | 'slug_taken'
  | 'email_taken'
  | 'nothing_to_accept'
  | 'hold_expired'
  | 'code_expired'
  | 'body_too_large'
  | 'unsupported_media_type'
  | 'validation'
  | 'idempotency_conflict'
  | 'code_incorrect'
  | 'season_empty'
  | 'stepup_locked'
  | 'resend_too_soon'
  | 'code_send_limit'
  | 'billing_unavailable';

const STATUS: Record<ErrorCode, number> = {
  invalid_json: 400,
  unauthenticated: 401,
  invalid_credentials: 401,
  forbidden: 403,
  cross_origin: 403,
  members_priority: 403,
  stepup_required: 403,
  not_found: 404,
  method_not_allowed: 405,
  idempotency_in_progress: 409,
  seat_taken: 409,
  not_on_sale: 409,
  screening_closed: 409,
  hold_already_paid: 409,
  booking_not_paid: 409,
  already_refunded: 409,
  booking_checked_in: 409,
  refund_window_closed: 409,
  already_checked_in: 409,
  checkin_not_open: 409,
  checkin_closed: 409,
  ticket_refunded: 409,
  already_member: 409,
  not_member: 409,
  no_change: 409,
  change_pending: 409,
  gift_membership_locked: 409,
  illegal_transition: 409,
  season_has_future_screenings: 409,
  season_closed: 409,
  slug_taken: 409,
  email_taken: 409,
  nothing_to_accept: 409,
  hold_expired: 410,
  code_expired: 410,
  body_too_large: 413,
  unsupported_media_type: 415,
  validation: 422,
  idempotency_conflict: 422,
  code_incorrect: 422,
  season_empty: 422,
  stepup_locked: 429,
  resend_too_soon: 429,
  code_send_limit: 429,
  billing_unavailable: 503,
};

export type FieldErrors = Record<string, { key: string; args?: Args }>;

export type ApiErrorOptions = {
  args?: Args;
  fields?: FieldErrors;
  seats?: string[];
  attemptsLeft?: number;
  retryAfterSeconds?: number;
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly options: ApiErrorOptions;

  constructor(code: ErrorCode, options: ApiErrorOptions = {}) {
    super(code);
    this.code = code;
    this.status = STATUS[code];
    this.options = options;
  }
}

export function fail(code: ErrorCode, options: ApiErrorOptions = {}): never {
  throw new ApiError(code, options);
}
