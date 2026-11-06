export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string> | undefined;
  readonly headers: Record<string, string> | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    options?: { fields?: Record<string, string>; headers?: Record<string, string> },
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = options?.fields;
    this.headers = options?.headers;
  }
}

export const errors = {
  crossSite: (): HttpError => new HttpError(403, 'cross_site_request', 'This request came from another site.'),
  payloadTooLarge: (): HttpError => new HttpError(413, 'payload_too_large', 'The request body is too large.'),
  fileTooLarge: (): HttpError => new HttpError(413, 'file_too_large', 'The file is too large to import.'),
  unsupportedMediaType: (): HttpError =>
    new HttpError(415, 'unsupported_media_type', 'Send this request as application/json.'),
  unauthenticated: (): HttpError => new HttpError(401, 'unauthenticated', 'Sign in to continue.'),
  sessionExpired: (): HttpError => new HttpError(401, 'session_expired', 'Your session ended.'),
  csrfInvalid: (): HttpError => new HttpError(403, 'csrf_token_invalid', 'This request is missing a valid token.'),
  notFound: (): HttpError => new HttpError(404, 'not_found', 'We could not find that.'),
  forbidden: (): HttpError => new HttpError(403, 'forbidden', 'Your role does not allow that.'),
  methodNotAllowed: (): HttpError =>
    new HttpError(405, 'method_not_allowed', 'That method is not allowed here.', { headers: { Allow: 'GET' } }),
  validation: (fields: Record<string, string>): HttpError =>
    new HttpError(422, 'validation', 'Some values need fixing.', { fields }),
  internal: (): HttpError => new HttpError(500, 'internal', 'Something went wrong.'),
  conflict: (code: string, message: string): HttpError => new HttpError(409, code, message),
  gone: (code: string, message: string): HttpError => new HttpError(410, code, message),
  rateLimited: (code: string, message: string, retryAfterSeconds: number): HttpError =>
    new HttpError(429, code, message, {
      headers: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) },
    }),
  storageUnavailable: (): HttpError =>
    new HttpError(503, 'storage_unavailable', 'File storage is unavailable right now.'),
};
