/** The one error shape of the API, and the one place each error code's copy lives. */

export type ErrorCode =
  | 'unsupported_type'
  | 'too_large'
  | 'database_unavailable'
  | 'not_signed_in'
  | 'bad_credentials'
  | 'forbidden'
  | 'not_found'
  | 'too_early'
  | 'window_closed'
  | 'turnout_busy'
  | 'window_full'
  | 'illegal_transition'
  | 'allocation_exceeded'
  | 'not_reopenable'
  | 'nothing_to_ration'
  | 'not_holder'
  | 'card_not_open'
  | 'window_not_open'
  | 'no_successor'
  | 'restriction_exists'
  | 'revision_conflict'
  | 'restore_below_committed'
  | 'pack_stale'
  | 'pack_mailed'
  | 'not_stored'
  | 'already_erased';

const STATUS: Record<ErrorCode, number> = {
  unsupported_type: 415,
  too_large: 413,
  database_unavailable: 503,
  not_signed_in: 401,
  bad_credentials: 401,
  forbidden: 403,
  not_found: 404,
  too_early: 409,
  window_closed: 409,
  turnout_busy: 409,
  window_full: 409,
  illegal_transition: 409,
  allocation_exceeded: 409,
  not_reopenable: 409,
  nothing_to_ration: 409,
  not_holder: 409,
  card_not_open: 409,
  window_not_open: 409,
  no_successor: 409,
  restriction_exists: 409,
  revision_conflict: 409,
  restore_below_committed: 409,
  pack_stale: 409,
  pack_mailed: 409,
  not_stored: 409,
  already_erased: 409,
};

const MESSAGES: Record<ErrorCode, string> = {
  unsupported_type: 'Send this request as application/json.',
  too_large: 'That request body is too large.',
  database_unavailable: 'The database is not answering yet.',
  not_signed_in: 'Sign in to continue.',
  bad_credentials: 'That email and password do not match.',
  forbidden: 'Your role cannot do that.',
  not_found: 'That record was not found.',
  too_early: 'Orders open 10 days before a window opens.',
  window_closed: 'This window has closed.',
  turnout_busy: 'This turnout already has an order scheduled or running.',
  window_full: 'Not enough capacity left in this window.',
  illegal_transition: 'That change is not allowed for this order now.',
  allocation_exceeded: 'This grower does not have enough allocation left.',
  not_reopenable: 'This order cannot be reopened.',
  nothing_to_ration: 'No requested orders to ration.',
  not_holder: 'This gate card has moved to another operator.',
  card_not_open: 'This gate card is no longer open.',
  window_not_open: 'This window is not open yet.',
  no_successor: 'No standby or rostered operator can take this card.',
  restriction_exists: 'This window already has a restriction.',
  revision_conflict: 'Another dispatcher saved first. Each cap settled to the lower value.',
  restore_below_committed: 'Restoring that revision would cut below what is already committed.',
  pack_stale: 'The records changed since your preview. Preview again before signing.',
  pack_mailed: 'This pack has already been mailed.',
  not_stored: 'This pack is not stored yet.',
  already_erased: 'This contractor has already been erased.',
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly extra: Record<string, unknown>;

  constructor(code: ErrorCode, extra: Record<string, unknown> = {}, message?: string) {
    super(message ?? MESSAGES[code]);
    this.code = code;
    this.status = STATUS[code];
    this.extra = extra;
  }

  body(): Record<string, unknown> {
    return { error: this.code, message: this.message, ...this.extra };
  }
}

export class ValidationError extends Error {
  readonly errors: Record<string, string>;
  readonly status = 422;

  constructor(errors: Record<string, string>) {
    super('Validation failed');
    this.errors = errors;
  }

  static field(field: string, message: string): ValidationError {
    return new ValidationError({ [field]: message });
  }

  body(): Record<string, unknown> {
    return { errors: this.errors };
  }
}

export const VALIDATION_COPY = {
  turnoutOffChannel: 'Choose one of your turnouts on this window\'s channel.',
  turnoutLimit: (turnoutCode: string, maxVolume: string): string =>
    `More than ${turnoutCode} can pass in this window: ${maxVolume} ML.`,
  allocation: (remaining: string): string => `More than your remaining allocation of ${remaining} ML.`,
} as const;

export const PLACE_WINDOW_FULL_MESSAGE =
  "Another order took the last of this window's capacity. Nothing was debited from your allocation.";
