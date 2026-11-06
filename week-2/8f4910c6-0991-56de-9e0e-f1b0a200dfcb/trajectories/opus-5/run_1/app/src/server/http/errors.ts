import type { ApiErrorBody } from '../../shared/types.js';

/** The one error shape used by every API answer. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;
  readonly headers: Record<string, string>;

  constructor(status: number, body: ApiErrorBody, headers: Record<string, string> = {}) {
    super(body.error);
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

export const unauthenticated = (): ApiError => new ApiError(401, { error: 'unauthenticated' });
export const sessionEnded = (): ApiError => new ApiError(401, { error: 'session_ended' });
export const accessRemoved = (): ApiError => new ApiError(401, { error: 'access_removed' });
export const notFound = (): ApiError => new ApiError(404, { error: 'not_found' });
export const gone = (code = 'gone'): ApiError => new ApiError(410, { error: code });
export const forbidden = (): ApiError => new ApiError(403, { error: 'forbidden' });
export const methodNotAllowed = (allow: string[]): ApiError =>
  new ApiError(405, { error: 'method_not_allowed' }, { Allow: allow.join(', ') });
export const rateLimited = (retryAfterSeconds: number): ApiError =>
  new ApiError(
    429,
    { error: 'rate_limited', retryAfterSeconds },
    { 'Retry-After': String(retryAfterSeconds) },
  );
export const tooLarge = (limitBytes: number): ApiError =>
  new ApiError(413, { error: 'too_large', limitBytes });
export const unsupportedMediaType = (): ApiError => new ApiError(415, { error: 'unsupported_media_type' });
export const badJson = (): ApiError => new ApiError(400, { error: 'bad_json' });
export const idempotencyKeyRequired = (): ApiError => new ApiError(400, { error: 'idempotency_key_required' });
export const idempotencyKeyReused = (): ApiError => new ApiError(409, { error: 'idempotency_key_reused' });
export const conflict = (code: string, extra: Record<string, unknown> = {}): ApiError =>
  new ApiError(409, { error: code, ...extra });
export const staleVersion = (savedBy: string, savedAt: string): ApiError =>
  new ApiError(412, { error: 'stale_version', savedBy, savedAt });
export const validation = (errors: Record<string, string>): ApiError =>
  new ApiError(422, { error: 'validation', errors });
export const billingUnavailable = (): ApiError => new ApiError(503, { error: 'billing_unavailable' });
export const storageUnavailable = (): ApiError => new ApiError(503, { error: 'storage_unavailable' });
