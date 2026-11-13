// The one error shape (DP-54). Every API error is built here.

export type FieldErrors = Record<string, string>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: FieldErrors | undefined;
  readonly headers: Record<string, string> | undefined;

  constructor(status: number, code: string, message: string, fields?: FieldErrors, headers?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.headers = headers;
  }

  body(): string {
    const error: { code: string; message: string; fields?: FieldErrors } = {
      code: this.code,
      message: this.message,
    };
    if (this.fields && Object.keys(this.fields).length > 0) error.fields = this.fields;
    return JSON.stringify({ error });
  }
}

export const errors = {
  notFound: (): ApiError => new ApiError(404, 'not_found', 'Not found.'),
  internal: (): ApiError => new ApiError(500, 'internal_error', 'Something went wrong.'),
  methodNotAllowed: (allow: string): ApiError =>
    new ApiError(405, 'method_not_allowed', 'Method not allowed.', undefined, { Allow: allow }),
  payloadTooLarge: (message: string): ApiError => new ApiError(413, 'payload_too_large', message),
  rateLimited: (retryAfterSeconds: number, message: string): ApiError =>
    new ApiError(429, 'rate_limited', message, undefined, {
      'Retry-After': String(Math.max(0, retryAfterSeconds)),
    }),
  unauthenticated: (): ApiError => new ApiError(401, 'unauthenticated', 'Sign in to continue.'),
  sessionEnded: (): ApiError => new ApiError(401, 'session_ended', 'Your session ended. Sign in again to keep going \u2014 what you typed is still here.'),
  forbidden: (): ApiError => new ApiError(403, 'forbidden', 'You may not do that.'),
  unsupportedMediaType: (): ApiError => new ApiError(415, 'unsupported_media_type', 'Send JSON with a content type of application/json.'),
  malformedJson: (): ApiError => new ApiError(400, 'malformed_json', 'The request body is not valid JSON.'),
  validationFailed: (fields: FieldErrors, message?: string): ApiError =>
    new ApiError(422, 'validation_failed', message ?? 'There\u2019s a problem.', fields),
  stateConflict: (code: string, message: string): ApiError => new ApiError(409, code, message),
  staleEdit: (): ApiError => new ApiError(412, 'stale_edit', 'This piece changed since you opened it. Check the price and save again.'),
  pieceGone: (message: string): ApiError => new ApiError(410, 'piece_gone', message),
  pageEnded: (message: string): ApiError => new ApiError(410, 'page_ended', message),
  storageUnavailable: (message: string): ApiError => new ApiError(503, 'storage_unavailable', message),
  mailUnavailable: (message: string): ApiError => new ApiError(503, 'mail_unavailable', message),
};
