// The single error shape: {"error": code} plus "errors" for validation. Handlers throw these.

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
    readonly headers: Record<string, string> = {},
  ) {
    super(`${status} ${String(body.error)}`);
  }
}

export const unauthenticated = (): HttpError => new HttpError(401, { error: 'unauthenticated' });
export const notFound = (): HttpError => new HttpError(404, { error: 'not_found' });
export const forbidden = (): HttpError => new HttpError(403, { error: 'forbidden' });
export const conflict = (code: string, extra: Record<string, unknown> = {}): HttpError =>
  new HttpError(409, { error: code, ...extra });
export const invalid = (errors: Record<string, string>, code = 'invalid'): HttpError =>
  new HttpError(422, { error: code, errors });
export const storageUnavailable = (): HttpError => new HttpError(503, { error: 'storage_unavailable' });
export const tooLarge = (body: Record<string, unknown> = { error: 'too_large' }): HttpError => new HttpError(413, body);
export const unsupportedMedia = (): HttpError => new HttpError(415, { error: 'unsupported_media_type' });
export const rateLimited = (retryAfterSeconds: number): HttpError =>
  new HttpError(429, { error: 'rate_limited' }, { 'Retry-After': String(retryAfterSeconds) });
