import type { ApiErrorBody, Blocker, Booking, BookingState } from '../shared/types.js';

type ErrorExtras = Omit<ApiErrorBody['error'], 'code' | 'message'>;

/** The one error shape every API failure is produced through. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extras: ErrorExtras;

  constructor(status: number, code: string, message: string, extras: ErrorExtras = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extras = extras;
  }

  body(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, ...this.extras } };
  }
}

export const tooLarge = (message: string): ApiError => new ApiError(413, 'too_large', message);

export const unsupportedMediaType = (message: string): ApiError =>
  new ApiError(415, 'unsupported_media_type', message);

export const unauthenticated = (): ApiError =>
  new ApiError(401, 'unauthenticated', 'Sign in to continue');

export const notFound = (): ApiError => new ApiError(404, 'not_found', 'Not found');

export const forbidden = (): ApiError =>
  new ApiError(403, 'forbidden', 'Your role cannot do that');

export const crossOrigin = (): ApiError =>
  new ApiError(403, 'cross_origin', 'Cross-origin requests are not accepted');

export const idempotencyKeyReused = (): ApiError =>
  new ApiError(422, 'idempotency_key_reused', 'Idempotency-Key was used for a different request');

export const validation = (fields: Record<string, string>): ApiError =>
  new ApiError(422, 'validation', 'Check the highlighted fields', { fields });

export const invalidTransition = (ref: string, state: BookingState): ApiError =>
  new ApiError(409, 'invalid_transition', `Booking ${ref} is ${state}`);

export const unitTaken = (serial: string | null, nextFreeSerial: string | null): ApiError =>
  new ApiError(409, 'unit_taken', 'This unit was just booked', { serial, nextFreeSerial });

export const quoteExpired = (): ApiError =>
  new ApiError(409, 'quote_expired', 'This hold has ended');

export const certificateNotApproved = (): ApiError =>
  new ApiError(409, 'certificate_not_approved', 'Your certificate must be approved first');

export const certificateNotStored = (): ApiError =>
  new ApiError(
    409,
    'certificate_not_stored',
    'Your certificate could not be found. Upload it again.',
  );

export const quoteRepriced = (booking: Booking): ApiError =>
  new ApiError(409, 'quote_repriced', 'Prices changed', { booking });

export const unitNotOnShelf = (serials: string[]): ApiError =>
  new ApiError(409, 'unit_not_on_shelf', `${serials.join(', ')} not on the shelf`, { serials });

export const checkoutBlocked = (blockers: Blocker[]): ApiError =>
  new ApiError(409, 'checkout_blocked', 'Checkout is blocked', { blockers });

export const closeBlocked = (blockers: Blocker[]): ApiError =>
  new ApiError(409, 'close_blocked', 'Closing is blocked', { blockers });

export const photosNotStored = (serials: string[]): ApiError =>
  new ApiError(
    409,
    'photos_not_stored',
    `Condition photos are not stored for ${serials.join(', ')}`,
    { serials },
  );

export const unitAlreadyReturned = (serial: string): ApiError =>
  new ApiError(409, 'unit_already_returned', `${serial} is already checked in`);

export const illegalMove = (serial: string, from: string, to: string): ApiError =>
  new ApiError(409, 'illegal_move', `${serial} can't move from ${from} to ${to}`);

export const paymentDeclined = (): ApiError =>
  new ApiError(402, 'payment_declined', 'Payment was declined');

export const paymentsUnavailable = (): ApiError =>
  new ApiError(503, 'payments_unavailable', 'Payment service unreachable');

export const storageUnavailable = (): ApiError =>
  new ApiError(503, 'storage_unavailable', 'Storage service unreachable');

export const mailUnavailable = (): ApiError =>
  new ApiError(503, 'mail_unavailable', 'Mail service unreachable');

export const invalidPasscode = (): ApiError =>
  new ApiError(401, 'invalid_passcode', "That passcode isn't recognised");
