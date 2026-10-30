import type { ApiError, Cell, Quote } from '../../shared/types.js';

/**
 * The one error code table. Each code has one HTTP status and one rank in the
 * error precedence; a request is answered by the failing check of lowest rank.
 */
const CODES = {
  cross_origin: { status: 403, rank: 1 },
  payload_too_large: { status: 413, rank: 2 },
  file_too_large: { status: 413, rank: 2 },
  unsupported_media_type: { status: 415, rank: 2 },
  invalid_json: { status: 400, rank: 3 },
  unauthenticated: { status: 401, rank: 4 },
  invalid_credentials: { status: 401, rank: 4 },
  not_found: { status: 404, rank: 5 },
  forbidden: { status: 403, rank: 6 },
  idempotency_key_reused: { status: 409, rank: 7 },
  hold_not_active: { status: 409, rank: 8 },
  hold_expired: { status: 410, rank: 8 },
  invalid_transition: { status: 409, rank: 8 },
  booking_day_not_reached: { status: 409, rank: 8 },
  validation: { status: 422, rank: 9 },
  compliance_blocked: { status: 422, rank: 9 },
  same_day_closed: { status: 422, rank: 9 },
  cell_in_past: { status: 422, rank: 9 },
  unsupported_type: { status: 415, rank: 9 },
  cells_taken: { status: 409, rank: 10 },
  series_conflict: { status: 409, rank: 10 },
  quote_changed: { status: 409, rank: 10 },
  rate_card_exists: { status: 409, rank: 10 },
  billing_unavailable: { status: 503, rank: 11 },
  files_unavailable: { status: 503, rank: 11 },
  mail_unavailable: { status: 503, rank: 11 },
} as const;

export type ErrorCode = keyof typeof CODES;

export class ApiFailure extends Error {
  readonly status: number;
  readonly rank: number;
  readonly body: ApiError;

  constructor(code: ErrorCode, message: string, extra: Omit<ApiError, 'error' | 'message'> = {}) {
    super(message);
    this.name = 'ApiFailure';
    this.status = CODES[code].status;
    this.rank = CODES[code].rank;
    this.body = { error: code, message, ...extra };
  }
}

/** The first failure in precedence order. */
export function firstFailure(...candidates: (ApiFailure | null)[]): ApiFailure | null {
  let chosen: ApiFailure | null = null;
  for (const candidate of candidates) {
    if (candidate && (chosen === null || candidate.rank < chosen.rank)) chosen = candidate;
  }
  return chosen;
}

export const failures = {
  crossOrigin: (): ApiFailure =>
    new ApiFailure('cross_origin', 'Only same-origin requests are accepted.'),
  payloadTooLarge: (): ApiFailure =>
    new ApiFailure('payload_too_large', 'Request bodies can be at most 64,000 bytes.'),
  fileTooLarge: (): ApiFailure =>
    new ApiFailure('file_too_large', 'Files can be at most 5,000,000 bytes.'),
  unsupportedMediaType: (): ApiFailure =>
    new ApiFailure('unsupported_media_type', 'Send this request as application/json.'),
  invalidJson: (): ApiFailure => new ApiFailure('invalid_json', 'The request body is not valid JSON.'),
  unauthenticated: (): ApiFailure => new ApiFailure('unauthenticated', 'Sign in to continue.'),
  invalidCredentials: (): ApiFailure =>
    new ApiFailure('invalid_credentials', 'Email or password is incorrect.'),
  notFound: (): ApiFailure => new ApiFailure('not_found', 'No such record.'),
  forbidden: (): ApiFailure =>
    new ApiFailure('forbidden', 'Your role cannot perform this action.'),
  idempotencyKeyReused: (): ApiFailure =>
    new ApiFailure(
      'idempotency_key_reused',
      'That idempotency key was already used for a different request.',
    ),
  validation: (errors: Record<string, string>): ApiFailure =>
    new ApiFailure('validation', 'Some fields need attention.', { errors }),
  holdNotActive: (state: string): ApiFailure =>
    new ApiFailure('hold_not_active', 'This hold is no longer active.', { state }),
  holdExpired: (): ApiFailure => new ApiFailure('hold_expired', 'This hold has expired.'),
  invalidTransition: (from: string, to: string): ApiFailure =>
    new ApiFailure('invalid_transition', `Cannot move from ${from} to ${to}.`, { from, to }),
  bookingDayNotReached: (): ApiFailure =>
    new ApiFailure(
      'booking_day_not_reached',
      'This booking can only be checked in or marked no-show from its booking day.',
    ),
  complianceBlocked: (message: string): ApiFailure => new ApiFailure('compliance_blocked', message),
  sameDayClosed: (cutoff: string): ApiFailure =>
    new ApiFailure('same_day_closed', `Same-day booking closed at ${cutoff} kitchen time.`),
  cellInPast: (): ApiFailure =>
    new ApiFailure('cell_in_past', 'Some of those cells have already started.'),
  unsupportedType: (): ApiFailure =>
    new ApiFailure('unsupported_type', 'Upload a PDF, PNG or JPEG file.'),
  cellsTaken: (taken: Cell[]): ApiFailure =>
    new ApiFailure('cells_taken', 'Those cells were just taken.', { taken }),
  seriesConflict: (dates: string[], taken: { date: string; station_id: string; start: string }[]): ApiFailure => {
    const failure = new ApiFailure('series_conflict', 'Some weeks of that series are already taken.', {
      dates,
    });
    Object.assign(failure.body, { taken });
    return failure;
  },
  quoteChanged: (quote: Quote): ApiFailure =>
    new ApiFailure('quote_changed', 'The price changed since that quote.', { quote }),
  rateCardExists: (date: string): ApiFailure =>
    new ApiFailure('rate_card_exists', `A rate card already starts on ${date}.`),
  billingUnavailable: (): ApiFailure =>
    new ApiFailure('billing_unavailable', 'Billing is unreachable, so nothing was changed.'),
  filesUnavailable: (): ApiFailure =>
    new ApiFailure('files_unavailable', 'File storage is unreachable.'),
  mailUnavailable: (): ApiFailure =>
    new ApiFailure('mail_unavailable', 'Email is unreachable, so nothing was changed.'),
};
