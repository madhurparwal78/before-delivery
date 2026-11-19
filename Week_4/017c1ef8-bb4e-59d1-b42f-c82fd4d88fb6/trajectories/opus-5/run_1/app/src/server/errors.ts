/**
 * Every API error is produced here, in the one published shape, and the router
 * applies the one published precedence order.
 */
export type ErrorBody = Record<string, unknown> & { error: string };

export class ApiError extends Error {
  readonly status: number;
  readonly body: ErrorBody;

  constructor(status: number, body: ErrorBody) {
    super(body.error);
    this.status = status;
    this.body = body;
  }
}

export const crossOrigin = (): ApiError => new ApiError(403, { error: 'cross_origin' });
export const payloadTooLarge = (): ApiError => new ApiError(413, { error: 'payload_too_large' });
export const unsupportedMediaType = (): ApiError =>
  new ApiError(415, { error: 'unsupported_media_type' });
export const unauthenticated = (): ApiError => new ApiError(401, { error: 'unauthenticated' });
export const notFound = (): ApiError => new ApiError(404, { error: 'not_found' });
export const idempotencyKeyReused = (): ApiError =>
  new ApiError(422, { error: 'idempotency_key_reused' });

export type ForbiddenCode =
  | 'not_connected'
  | 'not_poster'
  | 'not_applicant'
  | 'not_author'
  | 'not_admin'
  | 'own_profile';

export const forbidden = (code: ForbiddenCode): ApiError => new ApiError(403, { error: code });

export const conflict = (code: string, extra: Record<string, unknown> = {}): ApiError =>
  new ApiError(409, { error: code, ...extra });

export const validation = (fields: Record<string, string>): ApiError =>
  new ApiError(422, { error: 'validation', fields });

export const namedValidation = (code: string, extra: Record<string, unknown> = {}): ApiError =>
  new ApiError(422, { error: code, ...extra });

export const weeklyInviteLimit = (limit: number): ApiError =>
  new ApiError(429, { error: 'weekly_invite_limit', limit });

export const storageUnavailable = (): ApiError => new ApiError(503, { error: 'storage_unavailable' });
