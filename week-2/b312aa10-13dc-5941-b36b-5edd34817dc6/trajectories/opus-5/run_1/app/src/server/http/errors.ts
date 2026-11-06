/**
 * The published copy of every error code, in one place. Handlers never build a
 * message from a caught error's own text.
 */
import { monthLabel } from '../../shared/calendar.js';
import {
  bookingStatusWord,
  documentStatusWord,
  documentTypeLabel,
  formatHours,
  formatMoney,
  type BookingStatus,
  type DocumentStatus,
  type DocumentType,
} from '../../shared/format.js';

export type TakenEntry = {
  stationId: string;
  stationName: string;
  date: string;
  start: string | null;
  end: string | null;
};

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly copy: string;
  readonly extra: Record<string, unknown>;
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    code: string,
    copy: string,
    extra: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ) {
    super(code);
    this.status = status;
    this.code = code;
    this.copy = copy;
    this.extra = extra;
    this.headers = headers;
  }

  body(): Record<string, unknown> {
    return { error: this.code, message: this.copy, ...this.extra };
  }
}

export const errors = {
  badRequest: (): AppError => new AppError(400, 'bad_request', 'The request body is not valid JSON.'),

  idempotencyKeyRequired: (): AppError =>
    new AppError(
      400,
      'idempotency_key_required',
      'Send an Idempotency-Key header of 8 to 128 letters, digits, hyphens or underscores.',
    ),

  unauthenticated: (): AppError => new AppError(401, 'unauthenticated', 'Sign in to continue.'),

  invalidCredentials: (): AppError =>
    new AppError(401, 'invalid_credentials', 'Email or password is incorrect.'),

  forbidden: (): AppError => new AppError(403, 'forbidden', 'Your role cannot do that.'),

  crossOrigin: (): AppError =>
    new AppError(403, 'cross_origin', 'Requests from other sites are refused.'),

  notFound: (): AppError => new AppError(404, 'not_found', 'That was not found.'),

  readOnly: (): AppError => new AppError(405, 'read_only', 'Inspector links are read-only.'),

  blockTaken: (taken: TakenEntry[]): AppError => {
    const first = taken[0];
    const copy =
      first && first.start === null
        ? `${first.stationName} ${first.date} was taken.`
        : `${first?.stationName ?? ''} ${first?.start ?? ''} block was taken.`;
    return new AppError(409, 'block_taken', copy, { taken });
  },

  invalidTransitionBooking: (
    from: BookingStatus,
    action: string,
    current: unknown,
  ): AppError =>
    new AppError(
      409,
      'invalid_transition',
      `That action is not available for a ${bookingStatusWord(from)} block.`,
      { from, action, current },
    ),

  invalidTransitionDocument: (
    from: DocumentStatus,
    action: string,
    current: unknown,
  ): AppError =>
    new AppError(
      409,
      'invalid_transition',
      `That action is not available for a ${documentStatusWord(from)} document.`,
      { from, action, current },
    ),

  documentSuperseded: (
    type: DocumentType,
    business: string,
    current: unknown,
    supersededBy: string,
  ): AppError =>
    new AppError(
      409,
      'document_superseded',
      `A newer ${documentTypeLabel(type)} from ${business} is waiting. Approve that one instead.`,
      { current, supersededBy },
    ),

  holdExpired: (blockLabel: string): AppError =>
    new AppError(409, 'hold_expired', `Your hold on ${blockLabel} expired.`),

  idempotencyKeyReused: (): AppError =>
    new AppError(
      409,
      'idempotency_key_reused',
      'This request was already used for something else. Reload and try again.',
    ),

  monthClosed: (month: string): AppError =>
    new AppError(409, 'month_closed', `${monthLabel(month)} is closed.`),

  billingPending: (): AppError =>
    new AppError(
      409,
      'billing_pending',
      'Some charges are still waiting for billing. Try again once they are recorded.',
    ),

  billingMismatch: (members: string[], firstBusiness: string): AppError =>
    new AppError(
      409,
      'billing_mismatch',
      `Kill Bill's draft for ${firstBusiness} does not match Lineboard. The month stays open.`,
      { members },
    ),

  rateVersionExists: (stationName: string, date: string, time: string): AppError =>
    new AppError(
      409,
      'rate_version_exists',
      `A rate change for ${stationName} already starts ${date} ${time}.`,
    ),

  linkExpired: (): AppError => new AppError(410, 'link_expired', 'This link has expired.'),

  linkRevoked: (): AppError => new AppError(410, 'link_revoked', 'This link is no longer active.'),

  staleVersionMove: (current: unknown): AppError =>
    new AppError(
      412,
      'stale_version',
      'This block changed since you picked it up. The board now shows the latest version.',
      { current },
    ),

  staleVersionRules: (current: unknown): AppError =>
    new AppError(
      412,
      'stale_version',
      'Kitchen rules changed since you opened Settings. The latest rules are shown.',
      { current },
    ),

  staleVersionDocument: (current: unknown): AppError =>
    new AppError(
      412,
      'stale_version',
      'This document changed since you opened Documents. The latest version is shown.',
      { current },
    ),

  payloadTooLarge: (): AppError => new AppError(413, 'payload_too_large', 'This file is too large.'),

  unsupportedMediaType: (): AppError =>
    new AppError(415, 'unsupported_media_type', 'Send JSON with Content-Type application/json.'),

  unsupportedFileType: (): AppError =>
    new AppError(415, 'unsupported_file_type', 'Upload a PDF, PNG or JPEG file.'),

  validationFailed: (fieldErrors: Record<string, string>): AppError =>
    new AppError(422, 'validation_failed', 'Check the highlighted fields.', {
      errors: fieldErrors,
    }),

  rateLimited: (retryAfterSeconds: number): AppError => {
    const minutes = Math.ceil(retryAfterSeconds / 60);
    const unit = minutes === 1 ? 'minute' : 'minutes';
    return new AppError(
      429,
      'rate_limited',
      `Too many sign-in attempts. Try again in ${minutes} ${unit}.`,
      {},
      { 'Retry-After': String(retryAfterSeconds) },
    );
  },

  internal: (): AppError =>
    new AppError(500, 'internal', 'Lineboard hit an unexpected problem. Try again.'),

  billingUnavailable: (): AppError =>
    new AppError(
      503,
      'billing_unavailable',
      'Billing is unavailable. The month stays open; try again when billing is back.',
    ),

  storageUnavailableUpload: (): AppError =>
    new AppError(
      503,
      'storage_unavailable',
      'Document storage is unavailable. Your file was not saved; try again shortly.',
    ),

  storageUnavailableDownload: (): AppError =>
    new AppError(503, 'storage_unavailable', 'Document storage is unavailable. Try again shortly.'),
};

/** The published messages of a 422 `errors` object. */
export const fieldCopy = {
  cannotBeSet: 'This field cannot be set.',
  required: 'This field is required.',
  quarterHour: 'Times must fall on the quarter hour.',
  endAfterStart: 'End must be after start on the same day.',
  tooShort: 'A block must be at least 1 hour.',
  tooLong: 'A block can be at most 12 hours.',
  alreadyEnded: 'This block has already ended.',
  tooFarAhead: 'Bookings open 180 days ahead.',
  wrongKind: 'Move a block to a station of the same kind.',
  nonexistentTime: (time: string, date: string, zone: string): string =>
    `${time} does not exist on ${date} in ${zone} (clocks go forward).`,
  outOfService: (stationName: string): string => `${stationName} is out of service then.`,
  notEnoughHours: (needed: number, balance: number, month: string): string =>
    `That needs ${formatHours(needed)} hours; you have ${formatHours(balance)} left for ${monthLabel(month)}.`,
  documentMissing: (type: DocumentType): string =>
    `Upload an approved ${documentTypeLabel(type)} before booking.`,
  documentExpiresFirst: (type: DocumentType, date: string): string =>
    `Your ${documentTypeLabel(type)} expires on ${date}, before this block.`,
  checkInNoDocument: (type: DocumentType): string =>
    `No approved ${documentTypeLabel(type)} on file; check-in is refused.`,
  checkInExpired: (type: DocumentType, date: string): string =>
    `The ${documentTypeLabel(type)} expired on ${date}; check-in is refused.`,
  repeatWeeks: 'Repeat for 1 to 12 weeks.',
  days: 'Shelf bookings run 1 to 31 days.',
  notes: 'Notes can be at most 500 characters.',
  businessName: 'Business name must be 1 to 80 characters with no line breaks.',
  rateRange: 'Enter a rate from $0.01 to $1,000.00.',
  effectiveFromFuture: 'Rate changes must start in the future.',
  peakWindows: 'Peak windows need days and a start before the end, on the quarter hour.',
  version: 'Reload and try again.',
  documentType: 'Choose insurance certificate or food-handler card.',
  expiryDate: 'Enter an expiry date of today or later.',
  file: 'Choose a file to upload.',
  area: 'Choose an area.',
  task: 'Describe the task in 1 to 120 characters.',
  reason: 'Give a reason in 1 to 120 characters.',
  sanitizerPpm: 'Sanitizer strength is 0 to 400 ppm.',
  initials: 'Initials are 1 to 4 letters.',
  email: 'Enter a valid email address.',
  password: 'Enter your password.',
  expiresAt: 'Choose an expiry in the future, at most 30 days away.',
  month: 'Use a month in the form YYYY-MM.',
  date: 'Use a date in the form YYYY-MM-DD.',
} as const;

/** Used by the cancellation email and the cancel dialog's fee line. */
export function feeLine(penaltyCents: number): string {
  return penaltyCents > 0
    ? `Late cancellation fee: ${formatMoney(penaltyCents)}`
    : 'No cancellation fee';
}
