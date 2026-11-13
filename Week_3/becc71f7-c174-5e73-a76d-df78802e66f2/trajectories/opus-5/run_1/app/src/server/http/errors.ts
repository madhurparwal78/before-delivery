/** Every API error is built through this one shape. */

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    override readonly message: string,
    readonly fields: Record<string, string> | null = null,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }

  body(): ErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.fields === null ? {} : { fields: this.fields }),
      },
    };
  }
}

export const notFound = (): ApiError => new ApiError(404, 'not_found', 'That was not found.');

export const methodNotAllowed = (allow: readonly string[]): ApiError =>
  new ApiError(405, 'method_not_allowed', 'That method is not allowed here.', null, {
    Allow: allow.join(', '),
  });

export const payloadTooLarge = (message: string): ApiError =>
  new ApiError(413, 'payload_too_large', message);

export const rateLimited = (message: string, retryAfterSeconds: number): ApiError =>
  new ApiError(429, 'rate_limited', message, null, {
    'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))),
  });

export const unauthenticated = (): ApiError =>
  new ApiError(401, 'unauthenticated', 'Sign in to keep going.');

export const sessionEnded = (message: string): ApiError =>
  new ApiError(401, 'session_ended', message);

export const forbidden = (): ApiError =>
  new ApiError(403, 'forbidden', 'That is not yours to do.');

export const unsupportedMediaType = (expected: string): ApiError =>
  new ApiError(415, 'unsupported_media_type', `Send this request as ${expected}.`);

export const malformedJson = (): ApiError =>
  new ApiError(400, 'malformed_json', 'That request body is not valid JSON.');

export const validationFailed = (fields: Record<string, string>): ApiError =>
  new ApiError(422, 'validation_failed', 'Check the fields below.', fields);

export const conflict = (code: string, message: string): ApiError =>
  new ApiError(409, code, message);

export const staleEdit = (message: string): ApiError => new ApiError(412, 'stale_edit', message);

export const gone = (code: 'piece_gone' | 'page_ended', message: string): ApiError =>
  new ApiError(410, code, message);

export const storageUnavailable = (message: string): ApiError =>
  new ApiError(503, 'storage_unavailable', message);

export const mailUnavailable = (message: string): ApiError =>
  new ApiError(503, 'mail_unavailable', message);
