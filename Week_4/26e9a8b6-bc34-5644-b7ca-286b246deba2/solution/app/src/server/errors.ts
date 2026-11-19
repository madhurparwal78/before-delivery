/** The one error shape: every refusal is an ApiError, and `respondError` is the only place that writes one. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: { error: string } & Record<string, unknown>,
    readonly headers: Record<string, string> = {},
  ) {
    super(body.error);
  }
}

export const notFound = () => new ApiError(404, { error: 'not_found' });
export const notSignedIn = () => new ApiError(401, { error: 'not_signed_in' });
export const forbidden = () => new ApiError(403, { error: 'forbidden' });
export const unconfirmed = () => new ApiError(403, { error: 'unconfirmed' });
export const withdrawn = () => new ApiError(410, { error: 'withdrawn' });
export const conflict = (code: string, extra: Record<string, unknown> = {}) => new ApiError(409, { error: code, ...extra });
export const invalid = (field: string) => new ApiError(422, { error: 'invalid', field });
export const tooLong = (field: string, limit: number) => new ApiError(422, { error: 'too_long', field, limit });
export const tooMany = (field: string, limit: number) => new ApiError(422, { error: 'too_many', field, limit });
export const rateLimited = (seconds: number) =>
  new ApiError(429, { error: 'rate_limited', retry_after: seconds }, { 'Retry-After': String(seconds) });
export const storageUnavailable = () => new ApiError(503, { error: 'storage_unavailable' });
export const internal = () => new ApiError(500, { error: 'internal' });
export const unprocessable = (code: string, extra: Record<string, unknown> = {}) => new ApiError(422, { error: code, ...extra });
export const unavailable = (code: string) => new ApiError(503, { error: code });
export const badCredentials = () => new ApiError(401, { error: 'bad_credentials' });
export const tokenInvalid = () => new ApiError(410, { error: 'token_invalid' });
export const bodyTooLarge = (limit: number) => new ApiError(413, { error: 'body_too_large', limit });
export const modelTooLarge = (limit: number) => new ApiError(413, { error: 'model_too_large', limit });
export const methodNotAllowed = (allow: string) => new ApiError(405, { error: 'method_not_allowed' }, { Allow: allow });
export const unsupportedMediaType = () => new ApiError(415, { error: 'unsupported_media_type' });
