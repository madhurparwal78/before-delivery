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

export interface ApiErrorExtras {
  readonly fields?: Readonly<Record<string, string>>;
  readonly conflictsWith?: string;
  readonly reserved?: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    override readonly message: string,
    readonly extras: ApiErrorExtras = {},
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const FIELD_MESSAGES = {
  name: 'Enter a name of 1 to 80 characters.',
  email: 'Enter a valid email address.',
  signupPassword: 'Use at least 8 characters.',
  signinPassword: 'Enter your password.',
  guess: 'Enter a whole number from 1 to 100,000,000.',
  capacity: 'Enter a whole number from 1 to 500.',
  bio: 'Use at most 2,000 characters.',
  search: 'Use at most 2,048 characters.',
  limit: 'Enter a whole number from 1 to 100.',
  cursor: 'Start again from the first page.',
} as const;

export function invalidBody(): ApiError {
  return new ApiError(400, 'invalid', 'The request body is not valid JSON.');
}

export function invalidPath(): ApiError {
  return new ApiError(400, 'invalid', 'The request path is not valid.');
}

export function invalidIdempotencyKey(): ApiError {
  return new ApiError(400, 'invalid', 'The Idempotency-Key header is not valid.');
}

export function validationFailed(fields: Readonly<Record<string, string>>): ApiError {
  return new ApiError(422, 'invalid', 'Some of the values sent need attention.', { fields });
}

export function invalidFilter(): ApiError {
  return new ApiError(400, 'invalid_filter', 'That filter value is not one we publish.');
}

export function unauthenticated(): ApiError {
  return new ApiError(401, 'unauthenticated', 'Sign in to continue.');
}

export function invalidCredentials(): ApiError {
  return new ApiError(401, 'invalid_credentials', 'Email or password is incorrect.');
}

export function forbidden(): ApiError {
  return new ApiError(403, 'forbidden', 'This action is not open to your role.');
}

export function notFoundPath(): ApiError {
  return new ApiError(404, 'not_found', 'We could not find that path.');
}

export function notFoundSession(): ApiError {
  return new ApiError(404, 'not_found', 'We could not find that session.');
}

export function notFoundSpeaker(): ApiError {
  return new ApiError(404, 'not_found', 'We could not find that speaker.');
}

export function noSessions(): ApiError {
  return new ApiError(404, 'no_sessions', 'No session matches that filter.');
}

export function methodNotAllowed(allow: string): ApiError {
  return new ApiError(405, 'method_not_allowed', 'That method is not allowed on this path.', {}, { Allow: allow });
}

export function payloadTooLarge(): ApiError {
  return new ApiError(413, 'payload_too_large', 'The request body is larger than this endpoint accepts.');
}

export function unsupportedMediaType(): ApiError {
  return new ApiError(415, 'unsupported_media_type', 'The request body must be sent as JSON.');
}

export function unavailable(): ApiError {
  return new ApiError(503, 'unavailable', 'Keel Outpost is not reachable right now.');
}

const CONFLICT_MESSAGES: Readonly<Record<string, string>> = {
  email_taken: 'An account with this email already exists.',
  not_reservable: 'This session does not take reservations.',
  already_reserved: 'You already have a seat in this session.',
  session_full: 'This session is full.',
  already_waitlisted: 'You are already on the waitlist for this session.',
  seats_available: 'Seats are open in this session.',
  not_waitlisted: 'You are not on the waitlist for this session.',
  no_reservation: 'You do not hold a seat in this session.',
  no_hold: 'No seat is being held for you in this session.',
  hold_expired: 'Your hold on this seat has ended.',
  already_guessed: 'You have already submitted your guess.',
  contest_closed: 'Guessing has closed.',
  already_revealed: 'The result has already been revealed.',
  request_in_progress: 'Your earlier request is still being handled.',
  idempotency_key_reused: 'That request could not be repeated.',
};

export function conflict(
  code: Extract<ErrorCode, keyof typeof CONFLICT_MESSAGES | 'idempotency_key_reused'>,
): ApiError {
  const message = CONFLICT_MESSAGES[code];
  if (message === undefined) throw new Error(`no message for ${code}`);
  return new ApiError(code === 'idempotency_key_reused' ? 422 : 409, code, message);
}

export function timeConflict(conflictsWith: string): ApiError {
  return new ApiError(409, 'time_conflict', 'You already hold a seat in a session at that time.', {
    conflictsWith,
  });
}

export function belowReserved(reserved: number): ApiError {
  return new ApiError(
    409,
    'below_reserved',
    `Capacity cannot be lower than the ${reserved} seats already reserved or held.`,
    { reserved },
  );
}

export function rateLimited(retryAfterSeconds: number): ApiError {
  return new ApiError(
    429,
    'rate_limited',
    'Too many sign-in attempts. Try again in a few minutes.',
    {},
    { 'Retry-After': String(retryAfterSeconds) },
  );
}
