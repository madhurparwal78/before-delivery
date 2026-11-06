/**
 * API errors: one shape per version, built only here. No raw library or
 * database error ever reaches a response.
 */

export type ErrorCode =
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
  | 'idempotency_key_reused'
  | 'rate_limited'
  | 'unavailable';

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    public status: number,
    public message: string = '',
    public options: { fields?: Record<string, string>; extra?: Record<string, unknown>; retryAfter?: number } = {},
  ) {
    super(code);
  }
  get fields(): Record<string, string> | undefined {
    return this.options.fields;
  }
  get extra(): Record<string, unknown> | undefined {
    return this.options.extra;
  }
  get retryAfter(): number | undefined {
    return this.options.retryAfter;
  }
}

/** The readable sentence for a refusal, in the published voice. */
export const MESSAGES: Record<ErrorCode, (e: ApiError) => string> = {
  invalid: () => 'That request could not be read.',
  invalid_filter: () => 'That filter value is not one of the published ones.',
  unauthenticated: () => 'Sign in to continue.',
  invalid_credentials: () => 'Email or password is incorrect.',
  forbidden: () => 'This page is for the organiser only.',
  not_found: () => 'We could not find that.',
  no_sessions: () => 'No sessions match those filters.',
  method_not_allowed: () => 'That method is not published for this path.',
  payload_too_large: () => 'That request body is too large.',
  unsupported_media_type: () => 'That content type is not accepted.',
  email_taken: () => 'An account with this email already exists.',
  not_reservable: () => 'This session does not take reservations. Just turn up.',
  already_reserved: () => 'You already have a seat in this session.',
  time_conflict: () => 'You already hold a seat in another session at that time.',
  session_full: () => 'This session is full. Join the waitlist to be next in line.',
  already_waitlisted: () => 'You are already on the waitlist for this session.',
  seats_available: () => 'Seats are open. Reserve a seat instead.',
  not_waitlisted: () => 'You are not on the waitlist for this session.',
  no_reservation: () => 'You do not hold a seat in this session.',
  no_hold: () => 'No seat is being held for you in this session.',
  hold_expired: () => 'Your hold on this seat has ended.',
  below_reserved: (e) =>
    `Capacity cannot be lower than the ${e.extra?.reserved ?? 0} seats already reserved or held.`,
  already_guessed: () => 'You have already submitted your guess.',
  contest_closed: () => 'Guessing has closed.',
  already_revealed: () => 'The result has already been revealed.',
  request_in_progress: () => 'Your earlier request is still being handled.',
  idempotency_key_reused: () => 'That request could not be repeated. Press the button again.',
  rate_limited: () => 'Too many sign-in attempts. Try again in a few minutes.',
  unavailable: () => 'Keel Outpost is not reachable right now. Try again in a moment.',
};

/** The error body in the v1 shape. */
export function v1ErrorBody(e: ApiError): string {
  const message = MESSAGES[e.code](e);
  let body = `{"error":${JSON.stringify(e.code)},"message":${JSON.stringify(message)}`;
  if (e.fields) {
    const fieldPairs = Object.entries(e.fields).map(
      ([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`,
    );
    body += `,"fields":{${fieldPairs.join(',')}}`;
  }
  if (e.code === 'time_conflict' && e.extra?.conflicts_with) {
    body += `,"conflicts_with":${JSON.stringify(e.extra.conflicts_with)}`;
  }
  if (e.code === 'below_reserved') {
    body += `,"reserved":${JSON.stringify(e.extra?.reserved ?? 0)}`;
  }
  body += '}';
  return body;
}

/** The error body in the v2 shape. */
export function v2ErrorBody(e: ApiError): string {
  const message = MESSAGES[e.code](e);
  let detail = `{"code":${JSON.stringify(e.code)},"message":${JSON.stringify(message)}`;
  if (e.fields) {
    const fieldPairs = Object.entries(e.fields).map(
      ([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`,
    );
    detail += `,"fields":{${fieldPairs.join(',')}}`;
  }
  if (e.code === 'time_conflict' && e.extra?.conflicts_with) {
    detail += `,"conflicts_with":${JSON.stringify(e.extra.conflicts_with)}`;
  }
  if (e.code === 'below_reserved') {
    detail += `,"reserved":${JSON.stringify(e.extra?.reserved ?? 0)}`;
  }
  detail += '}';
  return `{"error":${detail}}`;
}
