// One error shape and the published precedence (DP-41).

export type FieldErrors = Record<string, string>;

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: FieldErrors,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function errorBody(error: AppError): Record<string, unknown> {
  const body: Record<string, unknown> = { code: error.code, message: error.message };
  if (error.extra) {
    Object.assign(body, error.extra);
  }
  const envelope: Record<string, unknown> = { error: body };
  if (error.fields) {
    envelope.fields = error.fields;
  }
  return envelope;
}

export const unauthenticated = (): AppError => new AppError(401, 'unauthenticated', 'Sign in first');
export const forbidden = (): AppError => new AppError(403, 'forbidden', 'You do not have access to do that');
export const notFound = (message = 'We could not find that'): AppError => new AppError(404, 'not_found', message);
export const crossOrigin = (): AppError => new AppError(403, 'cross_origin', 'Cross-origin requests are not allowed');
export const tooLarge = (): AppError => new AppError(413, 'too_large', 'That upload is too large');
export const unsupportedMediaType = (): AppError =>
  new AppError(415, 'unsupported_media_type', 'That content type is not accepted');

export const idempotencyKeyMissing = (): AppError =>
  new AppError(422, 'validation_error', 'Send an Idempotency-Key header', {
    idempotencyKey: 'Send an Idempotency-Key header',
  });

export const idempotencyKeyReused = (): AppError =>
  new AppError(422, 'idempotency_key_reused', 'Idempotency-Key was used for a different request');

export const stateConflict = (ref: string, state: string): AppError =>
  new AppError(409, 'invalid_transition', `Booking ${ref} is ${state}`);

export const unitTaken = (serial: string | null, nextFreeSerial: string | null): AppError =>
  new AppError(409, 'unit_taken', 'This unit was just booked', undefined, {
    serial,
    nextFreeSerial,
  });

export const paymentsUnavailable = (): AppError =>
  new AppError(503, 'payments_unavailable', 'Payment service unreachable');

export const storageUnavailable = (): AppError =>
  new AppError(503, 'storage_unavailable', 'Storage service unreachable');

export const mailUnavailable = (): AppError => new AppError(503, 'mail_unavailable', 'Mail service unreachable');

export const validation = (fields: FieldErrors, message = 'Check the highlighted fields'): AppError =>
  new AppError(422, 'validation_error', message, fields);
