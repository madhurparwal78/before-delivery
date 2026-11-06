/**
 * The one error shape and the one error precedence for every endpoint.
 *
 * Precedence, as published:
 *  1 body over the limit, 2 no session, 3 access removed, 4 idempotent replay,
 *  5 not found, 6 role not allowed, 7 state conflict, 8 validation,
 *  9 rate limit, 10 provider outage.
 */

export type ErrorExtras = Record<string, unknown>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extras: ErrorExtras;
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    code: string,
    extras: ErrorExtras = {},
    headers: Record<string, string> = {},
  ) {
    super(`${status} ${code}`);
    this.status = status;
    this.code = code;
    this.extras = extras;
    this.headers = headers;
  }

  body(): Record<string, unknown> {
    return { error: this.code, ...this.extras };
  }
}

export const bodyTooLarge = (limitBytes: number): ApiError =>
  new ApiError(413, 'body_too_large', { limitBytes });

export const sessionEnded = (): ApiError => new ApiError(401, 'session_ended');

export const accessRemoved = (): ApiError => new ApiError(403, 'access_removed');

export const notFound = (): ApiError => new ApiError(404, 'not_found');

export const forbidden = (): ApiError => new ApiError(403, 'forbidden');

export const overApprovalLimit = (limitCents: number, currency: string): ApiError =>
  new ApiError(403, 'over_approval_limit', { limitCents, currency });

export const ownVariation = (): ApiError => new ApiError(403, 'own_variation');

export const invalidCredentials = (): ApiError => new ApiError(401, 'invalid_credentials');

export const conflict = (code: string, extras: ErrorExtras = {}): ApiError =>
  new ApiError(409, code, extras);

export const illegalTransition = (from: string, action: string): ApiError =>
  new ApiError(409, 'illegal_transition', { from, action });

export const staleVersion = (savedBy: string, savedAt: string): ApiError =>
  new ApiError(412, 'stale_version', { savedBy, savedAt });

export const badRequest = (): ApiError => new ApiError(400, 'bad_request');

export const fileTooLarge = (limitBytes: number): ApiError =>
  new ApiError(413, 'file_too_large', { limitBytes });

export const rateLimited = (retryAfterSeconds: number): ApiError =>
  new ApiError(
    429,
    'rate_limited',
    { retryAfterSeconds },
    { 'Retry-After': String(retryAfterSeconds) },
  );

export const billingUnavailable = (): ApiError => new ApiError(503, 'billing_unavailable');

export const storageUnavailable = (): ApiError => new ApiError(503, 'storage_unavailable');

export class ValidationError extends ApiError {
  constructor(errors: Record<string, string>) {
    super(422, 'validation', { errors });
  }
}

export const validation = (errors: Record<string, string>): ValidationError =>
  new ValidationError(errors);

export const fieldError = (field: string, copy: string): ValidationError =>
  new ValidationError({ [field]: copy });
