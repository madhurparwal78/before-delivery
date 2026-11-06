export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    override readonly message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }

  body(): Record<string, unknown> {
    return { error: this.code, message: this.message, ...this.extra };
  }
}

export const invalidJson = (): ApiError =>
  new ApiError(400, 'invalid_json', 'The request body is not valid JSON.');

export const unauthenticated = (): ApiError =>
  new ApiError(401, 'unauthenticated', 'Sign in to continue.');

export const invalidCredentials = (): ApiError =>
  new ApiError(401, 'invalid_credentials', 'Email or password is wrong.');

export const notFound = (): ApiError => new ApiError(404, 'not_found', 'No such record.');

export const forbidden = (): ApiError =>
  new ApiError(403, 'forbidden', 'Your role cannot do that.');

export const validation = (fields: Record<string, string>): ApiError =>
  new ApiError(422, 'validation', 'Some fields need fixing.', { fields });

export const invalidTransition = (from: string, action: string): ApiError =>
  new ApiError(409, 'invalid_transition', `A booking in ${from} cannot ${action}.`, {
    from,
    action,
  });

export const billingUnavailable = (): ApiError =>
  new ApiError(503, 'billing_unavailable', 'Billing is unreachable, so nothing was charged.');

export const crossOrigin = (): ApiError =>
  new ApiError(403, 'cross_origin', 'Cross-origin writes are refused.');

export const bodyTooLarge = (): ApiError =>
  new ApiError(413, 'body_too_large', 'The request body is too large.');

export const unsupportedMediaType = (): ApiError =>
  new ApiError(415, 'unsupported_media_type', 'This endpoint takes application/json.');

export const idempotencyKeyRequired = (): ApiError =>
  new ApiError(400, 'idempotency_key_required', 'An Idempotency-Key header is required.');

export const idempotencyKeyReused = (): ApiError =>
  new ApiError(409, 'idempotency_key_reused', 'That idempotency key was used with another body.');

export const requestInProgress = (): ApiError =>
  new ApiError(409, 'request_in_progress', 'An earlier request with that key is still running.');

export const readOnly = (): ApiError =>
  new ApiError(405, 'read_only', 'The compliance binder is read-only.');
