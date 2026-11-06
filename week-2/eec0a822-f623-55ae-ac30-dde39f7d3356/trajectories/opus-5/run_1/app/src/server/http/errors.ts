export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly payload: Record<string, unknown>,
    readonly extraHeaders: Record<string, string> = {},
  ) {
    super(String(payload.error ?? 'error'));
  }
}

export const notFound = (): ApiError => new ApiError(404, { error: 'not_found' });

export const methodNotAllowed = (allow: string): ApiError =>
  new ApiError(405, { error: 'method_not_allowed' }, { Allow: allow });

export const rateLimited = (retryAfterSeconds: number): ApiError =>
  new ApiError(
    429,
    { error: 'rate_limited', retryAfterSeconds },
    { 'Retry-After': String(retryAfterSeconds) },
  );

export const unauthenticated = (): ApiError => new ApiError(401, { error: 'unauthenticated' });
export const sessionEnded = (): ApiError => new ApiError(401, { error: 'session_ended' });
export const accessRemoved = (): ApiError => new ApiError(401, { error: 'access_removed' });
export const yachtWithdrawn = (): ApiError => new ApiError(410, { error: 'yacht_withdrawn' });
export const pageEnded = (): ApiError => new ApiError(410, { error: 'page_ended' });
export const forbidden = (): ApiError => new ApiError(403, { error: 'forbidden' });

export const tooLarge = (limitBytes: number): ApiError =>
  new ApiError(413, { error: 'too_large', limitBytes });

export const unsupportedMediaType = (): ApiError =>
  new ApiError(415, { error: 'unsupported_media_type' });

export const invalidJson = (): ApiError => new ApiError(400, { error: 'invalid_json' });

export const conflict = (code: string, extra: Record<string, unknown> = {}): ApiError =>
  new ApiError(409, { error: code, ...extra });

export const preconditionFailed = (code: string, extra: Record<string, unknown> = {}): ApiError =>
  new ApiError(412, { error: code, ...extra });

export const validation = (errors: Record<string, string>): ApiError => new ApiError(422, { errors });

export const restRuleRefusal = (details: Record<string, unknown>): ApiError =>
  new ApiError(422, { error: 'rest_rule', ...details });

export const billingUnavailable = (): ApiError => new ApiError(503, { error: 'billing_unavailable' });
export const storageUnavailable = (): ApiError => new ApiError(503, { error: 'storage_unavailable' });
export const mailUnavailable = (): ApiError => new ApiError(503, { error: 'mail_unavailable' });
