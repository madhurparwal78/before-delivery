/** Every API error goes through this one shape and one precedence. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly headers: Record<string, string>;

  constructor(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) {
    super(String(body['error'] ?? 'error'));
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

export const notFound = (): ApiError => new ApiError(404, { error: 'not_found' });
export const notSignedIn = (): ApiError => new ApiError(401, { error: 'not_signed_in' });
export const withdrawn = (): ApiError => new ApiError(410, { error: 'withdrawn' });
export const forbidden = (): ApiError => new ApiError(403, { error: 'forbidden' });
export const unconfirmed = (): ApiError => new ApiError(403, { error: 'unconfirmed' });
export const mailUnavailable = (): ApiError => new ApiError(503, { error: 'mail_unavailable' });

export const methodNotAllowed = (allow: readonly string[]): ApiError =>
  new ApiError(405, { error: 'method_not_allowed' }, { Allow: allow.join(', ') });

export const unsupportedMediaType = (): ApiError =>
  new ApiError(415, { error: 'unsupported_media_type' });

export const bodyTooLarge = (limit: number): ApiError =>
  new ApiError(413, { error: 'body_too_large', limit });

export const tooDeep = (): ApiError => new ApiError(422, { error: 'too_deep' });

export const tooLong = (field: string, limit: number): ApiError =>
  new ApiError(422, { error: 'too_long', field, limit });

export const tooMany = (field: string, limit: number): ApiError =>
  new ApiError(422, { error: 'too_many', field, limit });

export const invalid = (field: string): ApiError => new ApiError(422, { error: 'invalid', field });

export const rateLimited = (seconds: number): ApiError =>
  new ApiError(
    429,
    { error: 'rate_limited', retry_after: seconds },
    { 'Retry-After': String(seconds) },
  );

export const conflict = (body: Record<string, unknown>): ApiError => new ApiError(409, body);

export const illegalTransition = (from: string, to: string): ApiError =>
  new ApiError(409, { error: 'illegal_transition', from, to });
