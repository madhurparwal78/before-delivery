// Every refusal is an ApiError; each version has exactly one builder for its error body.

export type Version = 'v1' | 'v2';

type ErrorCode =
  | 'invalid'
  | 'invalid_filter'
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'forbidden'
  | 'not_found'
  | 'no_sessions'
  | 'method_not_allowed'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'idempotency_key_reused'
  | 'email_taken'
  | 'not_reservable'
  | 'already_reserved'
  | 'time_conflict'
  | 'session_full'
  | 'already_waitlisted'
  | 'seats_available'
  | 'not_waitlisted'
  | 'no_reservation'
  | 'no_hold'
  | 'hold_expired'
  | 'below_reserved'
  | 'already_guessed'
  | 'contest_closed'
  | 'already_revealed'
  | 'request_in_progress'
  | 'rate_limited'
  | 'unavailable';

const STATUS: Record<ErrorCode, number> = {
  invalid: 400,
  invalid_filter: 400,
  unauthenticated: 401,
  invalid_credentials: 401,
  forbidden: 403,
  not_found: 404,
  no_sessions: 404,
  method_not_allowed: 405,
  payload_too_large: 413,
  unsupported_media_type: 415,
  idempotency_key_reused: 422,
  email_taken: 409,
  not_reservable: 409,
  already_reserved: 409,
  time_conflict: 409,
  session_full: 409,
  already_waitlisted: 409,
  seats_available: 409,
  not_waitlisted: 409,
  no_reservation: 409,
  no_hold: 409,
  hold_expired: 409,
  below_reserved: 409,
  already_guessed: 409,
  contest_closed: 409,
  already_revealed: 409,
  request_in_progress: 409,
  rate_limited: 429,
  unavailable: 503,
};

const MESSAGES: Record<ErrorCode, string> = {
  invalid: 'The request could not be read.',
  invalid_filter: 'Choose a day, stage and format from the published lists.',
  unauthenticated: 'Sign in to continue.',
  invalid_credentials: 'Email or password is incorrect.',
  forbidden: 'This page is for the organiser only.',
  not_found: 'We could not find that.',
  no_sessions: 'No sessions match these filters.',
  method_not_allowed: 'That method is not available here.',
  payload_too_large: 'The request body is too large.',
  unsupported_media_type: 'Send the request body as JSON.',
  idempotency_key_reused: 'That request could not be repeated. Press the button again.',
  email_taken: 'An account with this email already exists.',
  not_reservable: 'This session does not take reservations. Just turn up.',
  already_reserved: 'You already have a seat in this session.',
  time_conflict: 'You already hold a seat in a session at that time.',
  session_full: 'This session is full. Join the waitlist to be next in line.',
  already_waitlisted: 'You are already on the waitlist for this session.',
  seats_available: 'Seats are open. Reserve a seat instead.',
  not_waitlisted: 'You are not on the waitlist for this session.',
  no_reservation: 'You do not hold a seat in this session.',
  no_hold: 'No seat is being held for you in this session.',
  hold_expired: 'Your hold on this seat has ended.',
  below_reserved: 'Capacity cannot be lower than the seats already reserved or held.',
  already_guessed: 'You have already submitted your guess.',
  contest_closed: 'Guessing has closed.',
  already_revealed: 'The result has already been revealed.',
  request_in_progress: 'Your earlier request is still being handled.',
  rate_limited: 'Too many sign-in attempts. Try again in a few minutes.',
  unavailable: 'Keel Outpost is not reachable right now. Try again in a moment.',
};

interface ErrorExtras {
  fields?: Record<string, string>;
  conflicts_with?: string;
  reserved?: number;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    readonly extras: ErrorExtras = {},
    message: string = MESSAGES[code],
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.status = code === 'invalid' && extras.fields !== undefined ? 422 : STATUS[code];
  }
}

export function invalidFields(fields: Record<string, string>): ApiError {
  return new ApiError('invalid', { fields });
}

export function belowReserved(reserved: number): ApiError {
  return new ApiError(
    'below_reserved',
    { reserved },
    `Capacity cannot be lower than the ${reserved} seats already reserved or held.`,
  );
}

export function v1ErrorBody(error: ApiError): Record<string, unknown> {
  const body: Record<string, unknown> = { error: error.code, message: error.message };
  if (error.extras.fields !== undefined) body.fields = error.extras.fields;
  if (error.extras.conflicts_with !== undefined) body.conflicts_with = error.extras.conflicts_with;
  if (error.extras.reserved !== undefined) body.reserved = error.extras.reserved;
  return body;
}

export function v2ErrorBody(error: ApiError): Record<string, unknown> {
  const detail: Record<string, unknown> = { code: error.code, message: error.message };
  if (error.extras.fields !== undefined) detail.fields = error.extras.fields;
  if (error.extras.conflicts_with !== undefined) detail.conflicts_with = error.extras.conflicts_with;
  if (error.extras.reserved !== undefined) detail.reserved = error.extras.reserved;
  return { error: detail };
}
