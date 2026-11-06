export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
    readonly headers: Record<string, string> = {},
  ) {
    super(JSON.stringify(body));
  }
}

export function notFound(): ApiError {
  return new ApiError(404, { error: 'not_found' });
}

export function methodNotAllowed(allow: string): ApiError {
  return new ApiError(405, { error: 'method_not_allowed' }, { Allow: allow });
}

export function unauthenticated(): ApiError {
  return new ApiError(401, { error: 'unauthenticated' });
}

export function sessionEnded(): ApiError {
  return new ApiError(401, { error: 'session_ended' });
}

export function accessRemoved(): ApiError {
  return new ApiError(401, { error: 'access_removed' });
}

export function forbidden(): ApiError {
  return new ApiError(403, { error: 'forbidden' });
}

export function tooLarge(limitBytes: number): ApiError {
  return new ApiError(413, { error: 'too_large', limitBytes });
}

export function unsupportedMediaType(): ApiError {
  return new ApiError(415, { error: 'unsupported_media_type' });
}

export function invalidJson(): ApiError {
  return new ApiError(400, { error: 'invalid_json' });
}

export function stateConflict(code: string, extra: Record<string, unknown> = {}): ApiError {
  return new ApiError(code === 'stale_rota' ? 412 : 409, { error: code, ...extra });
}

export function fieldErrors(errors: Record<string, string>): ApiError {
  return new ApiError(422, { errors });
}

export function serviceUnavailable(code: 'billing_unavailable' | 'storage_unavailable' | 'mail_unavailable'): ApiError {
  return new ApiError(503, { error: code });
}

export function rateLimited(retryAfterSeconds: number): ApiError {
  return new ApiError(429, { error: 'rate_limited', retryAfterSeconds }, { 'Retry-After': String(Math.max(1, Math.round(retryAfterSeconds))) });
}

export function pageEnded(): ApiError {
  return new ApiError(410, { error: 'page_ended' });
}

export function yachtWithdrawn(): ApiError {
  return new ApiError(410, { error: 'yacht_withdrawn' });
}
