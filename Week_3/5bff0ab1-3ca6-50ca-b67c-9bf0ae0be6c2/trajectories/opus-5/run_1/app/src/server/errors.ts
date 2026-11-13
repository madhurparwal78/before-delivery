export type ErrorCode =
  | 'unauthenticated'
  | 'session_ended'
  | 'bad_credentials'
  | 'forbidden'
  | 'not_found'
  | 'method_not_allowed'
  | 'none_left'
  | 'slot_taken'
  | 'ride_cut_off'
  | 'lock_expired'
  | 'lock_exists_other_finish'
  | 'price_moved'
  | 'delivery_day_full'
  | 'delivery_day_closed'
  | 'delivery_day_has_places'
  | 'ride_exists'
  | 'illegal_state'
  | 'too_early'
  | 'mobile_taken'
  | 'too_large'
  | 'unsupported_media_type'
  | 'invalid_body'
  | 'invalid_slot'
  | 'licence_invalid'
  | 'licence_expired'
  | 'mcwg_required'
  | 'hub_unreachable'
  | 'sheet_unreachable'
  | 'notice_unreachable'
  | 'database_unreachable';

const STATUS: Readonly<Record<ErrorCode, number>> = {
  unauthenticated: 401,
  session_ended: 401,
  bad_credentials: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  none_left: 409,
  slot_taken: 409,
  ride_cut_off: 409,
  lock_expired: 409,
  lock_exists_other_finish: 409,
  price_moved: 409,
  delivery_day_full: 409,
  delivery_day_closed: 409,
  delivery_day_has_places: 409,
  ride_exists: 409,
  illegal_state: 409,
  too_early: 409,
  mobile_taken: 409,
  too_large: 413,
  unsupported_media_type: 415,
  invalid_body: 422,
  invalid_slot: 422,
  licence_invalid: 422,
  licence_expired: 422,
  mcwg_required: 422,
  hub_unreachable: 503,
  sheet_unreachable: 503,
  notice_unreachable: 503,
  database_unreachable: 503,
};

const MESSAGE: Readonly<Record<ErrorCode, string>> = {
  unauthenticated: 'Sign in to continue.',
  session_ended: 'Your session has ended. Sign in to continue.',
  bad_credentials: 'That mobile number and password do not match.',
  forbidden: 'This is not yours to read.',
  not_found: 'We could not find that.',
  method_not_allowed: 'That method is not allowed here.',
  none_left: 'That finish has just gone. Nothing was locked.',
  slot_taken: 'That slot has just been taken.',
  ride_cut_off: 'That slot has just closed.',
  lock_expired: 'That price lock has ended.',
  lock_exists_other_finish: 'You already hold a different lock on this model.',
  price_moved: 'The price has moved to a new step.',
  delivery_day_full: 'That day has just filled.',
  delivery_day_closed: 'That day has closed.',
  delivery_day_has_places: 'That day has a place now.',
  ride_exists: 'You already have a ride booked on this model.',
  illegal_state: 'That has already changed.',
  too_early: 'That cannot be marked yet.',
  mobile_taken: 'That mobile number already has an account.',
  too_large: 'That request is too large.',
  unsupported_media_type: 'Send this as JSON.',
  invalid_body: 'Some of those details are not right.',
  invalid_slot: 'That slot is not offered.',
  licence_invalid: 'Enter a licence number like MH1220190043210.',
  licence_expired: 'Your licence must be valid on the ride day.',
  mcwg_required: 'A test ride needs a licence that covers motorcycles with gear.',
  hub_unreachable: 'The hub system cannot be reached just now. Nothing was changed.',
  sheet_unreachable: 'The price sheet could not be made just now.',
  notice_unreachable: 'Phone notices could not be set up just now.',
  database_unreachable: 'The showroom records cannot be reached just now.',
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly headers: Record<string, string>;

  constructor(code: ErrorCode, headers: Record<string, string> = {}) {
    super(MESSAGE[code]);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS[code];
    this.headers = headers;
  }
}

export function fail(code: ErrorCode, headers?: Record<string, string>): never {
  throw new ApiError(code, headers);
}

/** The one error body shape for the whole API. */
export function errorBody(code: ErrorCode): { error: { code: ErrorCode; message: string } } {
  return { error: { code, message: MESSAGE[code] } };
}
