export type ErrorCode =
  | 'bad_request'
  | 'idempotency_key_required'
  | 'unauthorized'
  | 'invalid_credentials'
  | 'forbidden'
  | 'not_found'
  | 'method_not_allowed'
  | 'idempotency_in_progress'
  | 'idempotency_conflict'
  | 'out_of_stock'
  | 'illegal_transition'
  | 'quote_expired'
  | 'open_trade_in'
  | 'slot_full'
  | 'already_booked'
  | 'booking_closed'
  | 'too_late'
  | 'not_started'
  | 'code_already_applied'
  | 'email_taken'
  | 'too_many_requests'
  | 'already_protected'
  | 'already_applied'
  | 'not_delivered'
  | 'nothing_to_register'
  | 'already_registered'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'unknown_field'
  | 'validation_error'
  | 'unknown_board'
  | 'unknown_component'
  | 'incompatible'
  | 'limit'
  | 'invalid_code'
  | 'too_many_codes'
  | 'unsupported_country'
  | 'empty_cart'
  | 'credit_unavailable'
  | 'trade_in_not_applicable'
  | 'not_eligible'
  | 'window_closed'
  | 'invalid_token'
  | 'too_many_attempts'
  | 'internal_error'
  | 'billing_unavailable';

const CATALOGUE: Record<ErrorCode, { status: number; message: string }> = {
  bad_request: { status: 400, message: 'The request body is not valid JSON.' },
  idempotency_key_required: { status: 400, message: 'Send an Idempotency-Key header of 8 to 64 characters.' },
  unauthorized: { status: 401, message: 'Please sign in.' },
  invalid_credentials: { status: 401, message: 'Email or password is incorrect.' },
  forbidden: { status: 403, message: 'You do not have access to this.' },
  not_found: { status: 404, message: 'Not found.' },
  method_not_allowed: { status: 405, message: 'Method not allowed.' },
  idempotency_in_progress: { status: 409, message: 'This order is still being placed. Retry with the same key.' },
  idempotency_conflict: { status: 409, message: 'This key was already used for a different order.' },
  out_of_stock: { status: 409, message: 'Out of stock.' },
  illegal_transition: { status: 409, message: 'This order cannot be changed now.' },
  quote_expired: { status: 409, message: 'This quote has expired.' },
  open_trade_in: { status: 409, message: 'You already have an open trade-in.' },
  slot_full: { status: 409, message: 'This demo day is fully booked.' },
  already_booked: { status: 409, message: 'You already hold a seat at this time.' },
  booking_closed: { status: 409, message: 'Booking for this demo day has closed.' },
  too_late: { status: 409, message: 'Bookings can be cancelled up to 24 hours before the start.' },
  not_started: { status: 409, message: 'This demo day has not started yet.' },
  code_already_applied: { status: 409, message: 'This code is already applied.' },
  email_taken: { status: 409, message: 'An account with this email already exists.' },
  too_many_requests: { status: 409, message: 'You already have two callbacks booked.' },
  already_protected: { status: 409, message: 'This board is already protected.' },
  already_applied: { status: 409, message: 'This email has already applied.' },
  not_delivered: { status: 409, message: 'Boards can be registered once the order is delivered.' },
  nothing_to_register: { status: 409, message: 'Every board on this line is already registered.' },
  already_registered: { status: 409, message: 'This board is already registered.' },
  payload_too_large: { status: 413, message: 'The request body is too large.' },
  unsupported_media_type: { status: 415, message: 'Send the request body as JSON.' },
  unknown_field: { status: 422, message: 'This request has fields we do not accept.' },
  validation_error: { status: 422, message: 'Check the highlighted fields.' },
  unknown_board: { status: 422, message: 'Unknown board.' },
  unknown_component: { status: 422, message: 'Unknown part.' },
  incompatible: { status: 422, message: 'Not compatible.' },
  limit: { status: 422, message: 'Limit per order.' },
  invalid_code: { status: 422, message: 'This code is not valid.' },
  too_many_codes: { status: 422, message: 'Only two codes can be used.' },
  unsupported_country: { status: 422, message: 'We do not ship to this country yet.' },
  empty_cart: { status: 422, message: 'Your cart is empty.' },
  credit_unavailable: { status: 422, message: 'This credit is not available.' },
  trade_in_not_applicable: { status: 422, message: 'Trade-in credit applies to Crest boards only.' },
  not_eligible: { status: 422, message: 'Only boards can be registered.' },
  window_closed: { status: 422, message: 'Protection can be added within 30 days of your order.' },
  invalid_token: { status: 422, message: 'This reset link is invalid or has expired.' },
  too_many_attempts: { status: 429, message: 'Too many attempts. Try again later.' },
  internal_error: { status: 500, message: 'Something went wrong.' },
  billing_unavailable: { status: 503, message: 'Billing is unavailable. Your order was not placed.' },
};

export const NOT_FOUND_BUILD = 'We could not find that build.';
export const NOT_FOUND_MATCH = 'We could not find that match.';
export const NOT_FOUND_ORDER = 'We could not find an order with those details.';
export const NOT_FOUND_CASE = 'We could not find a case with those details.';

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: Record<string, string>;
  readonly headers?: Record<string, string>;

  constructor(
    code: ErrorCode,
    opts: { message?: string; fields?: Record<string, string>; status?: number; headers?: Record<string, string> } = {},
  ) {
    const entry = CATALOGUE[code];
    super(opts.message ?? entry.message);
    this.code = code;
    this.status = opts.status ?? entry.status;
    this.fields = opts.fields;
    this.headers = opts.headers;
  }

  body(): Record<string, unknown> {
    const out: Record<string, unknown> = { error: this.code, message: this.message };
    if (this.fields) out.fields = this.fields;
    return out;
  }
}

export function fail(
  code: ErrorCode,
  opts: { message?: string; fields?: Record<string, string>; status?: number; headers?: Record<string, string> } = {},
): never {
  throw new ApiError(code, opts);
}

export function failValidation(fields: Record<string, string>): never {
  throw new ApiError('validation_error', { fields });
}
