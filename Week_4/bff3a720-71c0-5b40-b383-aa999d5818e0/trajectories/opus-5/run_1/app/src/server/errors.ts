import { money } from '../shared/format.js';

export type ErrorCode =
  | 'unauthenticated'
  | 'not_found'
  | 'forbidden'
  | 'rate_limited'
  | 'seat_taken'
  | 'ride_changed'
  | 'edit_conflict'
  | 'request_expired'
  | 'already_decided'
  | 'booking_closed'
  | 'hold_expired'
  | 'already_rated'
  | 'rating_not_open'
  | 'rating_closed'
  | 'invalid_transition'
  | 'idempotency_conflict'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'validation_failed'
  | 'price_out_of_range'
  | 'too_many_stopovers'
  | 'insufficient_funds'
  | 'file_type'
  | 'file_too_large'
  | 'code_invalid'
  | 'code_expired'
  | 'storage_unavailable';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly copy: string;
  readonly fields?: Record<string, string>;
  readonly extra?: Record<string, unknown>;
  readonly headers?: Record<string, string>;

  constructor(
    status: number,
    code: ErrorCode,
    copy: string,
    options: {
      fields?: Record<string, string>;
      extra?: Record<string, unknown>;
      headers?: Record<string, string>;
    } = {},
  ) {
    super(copy);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.copy = copy;
    this.fields = options.fields;
    this.extra = options.extra;
    this.headers = options.headers;
  }

  body(): Record<string, unknown> {
    const body: Record<string, unknown> = { error: this.code, message: this.copy };
    if (this.fields) body.fields = this.fields;
    if (this.extra) Object.assign(body, this.extra);
    return body;
  }
}

function ceilDiv(value: number, divisor: number): number {
  return Math.ceil(value / divisor);
}

export const errors = {
  unauthenticated: () => new ApiError(401, 'unauthenticated', 'Sign in to continue.'),
  notFound: () => new ApiError(404, 'not_found', 'We could not find that.'),
  forbidden: () => new ApiError(403, 'forbidden', 'You do not have access to this.'),
  forbiddenUnverifiedDriver: () =>
    new ApiError(403, 'forbidden', 'Your ID must be verified before you can offer a ride.'),
  rateLimitedBookings: (limit: number, retryAfterSeconds: number) =>
    new ApiError(
      429,
      'rate_limited',
      `You have made ${limit} booking requests in the last hour. Try again in ${ceilDiv(
        retryAfterSeconds,
        60,
      )} minutes.`,
      { headers: { 'Retry-After': String(retryAfterSeconds) } },
    ),
  rateLimitedMessages: (retryAfterSeconds: number) =>
    new ApiError(
      429,
      'rate_limited',
      `You are sending messages too fast. Try again in ${retryAfterSeconds} seconds.`,
      { headers: { 'Retry-After': String(retryAfterSeconds) } },
    ),
  rateLimitedCodes: (retryAfterSeconds: number) =>
    new ApiError(
      429,
      'rate_limited',
      `Too many codes asked for. Try again in ${ceilDiv(retryAfterSeconds, 60)} minutes.`,
      { headers: { 'Retry-After': String(retryAfterSeconds) } },
    ),
  seatTaken: () =>
    new ApiError(409, 'seat_taken', 'This seat was just taken. Choose another span or ride.'),
  rideChanged: (ride: unknown) =>
    new ApiError(
      409,
      'ride_changed',
      'The driver changed this ride. Check the new times before booking.',
      { extra: { ride } },
    ),
  editConflict: () =>
    new ApiError(
      409,
      'edit_conflict',
      'This ride was changed in another window. Reload to see the latest version.',
    ),
  requestExpired: () =>
    new ApiError(409, 'request_expired', 'This request expired before you answered it.'),
  alreadyDecided: () => new ApiError(409, 'already_decided', 'This was already decided.'),
  bookingClosed: (minutes: number) =>
    new ApiError(
      409,
      'booking_closed',
      `Booking for this ride closed ${minutes} minutes before departure.`,
    ),
  holdExpired: () =>
    new ApiError(409, 'hold_expired', 'Your seat hold ran out. Choose your span again.'),
  alreadyRated: () => new ApiError(409, 'already_rated', 'You have already rated this trip.'),
  ratingNotOpen: () =>
    new ApiError(409, 'rating_not_open', 'You can rate this trip once it arrives.'),
  ratingClosed: () =>
    new ApiError(409, 'rating_closed', 'The rating window for this trip has closed.'),
  invalidTransition: () =>
    new ApiError(409, 'invalid_transition', 'This booking can no longer change that way.'),
  idempotencyConflict: () =>
    new ApiError(
      409,
      'idempotency_conflict',
      'This request was already sent with different details.',
    ),
  payloadTooLarge: () => new ApiError(413, 'payload_too_large', 'The request is too large.'),
  unsupportedMediaType: () =>
    new ApiError(415, 'unsupported_media_type', 'Send this request as JSON.'),
  validationFailed: (fields: Record<string, string>) =>
    new ApiError(422, 'validation_failed', 'Check the highlighted fields.', { fields }),
  priceOutOfRange: (lowCents: number, highCents: number, km: number) =>
    new ApiError(
      422,
      'price_out_of_range',
      `Set a price between ${money(lowCents)} and ${money(highCents)} for ${km} km.`,
    ),
  tooManyStopovers: (max: number) =>
    new ApiError(422, 'too_many_stopovers', `A ride can have at most ${max} stopovers.`),
  insufficientFunds: (balanceCents: number) =>
    new ApiError(
      422,
      'insufficient_funds',
      `Your wallet has ${money(balanceCents)}. Add money to book this seat.`,
    ),
  fileTypeIdDocument: () => new ApiError(422, 'file_type', 'Upload a PNG, JPEG or PDF file.'),
  fileTypePhoto: () => new ApiError(422, 'file_type', 'Upload a PNG or JPEG file.'),
  fileTooLarge: (maxBytes: number) =>
    new ApiError(422, 'file_too_large', `The file must be ${maxBytes / 1_048_576} MB or smaller.`),
  codeInvalid: () =>
    new ApiError(422, 'code_invalid', 'That code is not right. Check the email and try again.'),
  codeExpired: () =>
    new ApiError(422, 'code_expired', 'This code has expired. Ask for a new one.'),
  storageUnavailable: () =>
    new ApiError(
      503,
      'storage_unavailable',
      'We could not store your file right now. Nothing was lost; try again in a moment.',
    ),
};
