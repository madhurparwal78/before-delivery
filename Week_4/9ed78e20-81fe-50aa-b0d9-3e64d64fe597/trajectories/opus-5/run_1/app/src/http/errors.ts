export type ErrorFields = Readonly<Record<string, string>>;

/** The one error shape of the API. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: ErrorFields | undefined;
  readonly headers: Readonly<Record<string, string>> | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    options?: { readonly fields?: ErrorFields; readonly headers?: Readonly<Record<string, string>> },
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = options?.fields;
    this.headers = options?.headers;
  }

  body(): Record<string, unknown> {
    const payload: Record<string, unknown> = { error: this.code, message: this.message };
    if (this.fields !== undefined) payload.fields = this.fields;
    return payload;
  }
}

export const errors = {
  payloadTooLarge: (): ApiError =>
    new ApiError(413, 'payload_too_large', 'That request is too large.'),
  unsupportedMediaType: (message = 'Send this request as JSON.'): ApiError =>
    new ApiError(415, 'unsupported_media_type', message),
  unauthenticated: (): ApiError => new ApiError(401, 'unauthenticated', 'Sign in to continue.'),
  rateLimited: (seconds: number, headers: Readonly<Record<string, string>>): ApiError =>
    new ApiError(429, 'rate_limited', `Too many requests. Try again in ${seconds} seconds.`, {
      headers,
    }),
  signinLocked: (seconds: number): ApiError =>
    new ApiError(
      429,
      'signin_locked',
      `Too many failed sign-ins for this email. Try again in ${seconds} seconds.`,
      { headers: { 'Retry-After': String(seconds) } },
    ),
  invalidCredentials: (): ApiError =>
    new ApiError(
      401,
      'invalid_credentials',
      'That email and password do not match a staff account.',
    ),
  consoleNotFound: (): ApiError => new ApiError(404, 'not_found', 'No such item.'),
  publicNotFound: (): ApiError =>
    new ApiError(404, 'not_found', 'Nothing is published at this address.'),
  trackingNotFound: (): ApiError =>
    new ApiError(404, 'not_found', 'This tracking link is not valid.'),
  gone: (message = 'This item has been withdrawn.'): ApiError => new ApiError(410, 'gone', message),
  forbidden: (): ApiError =>
    new ApiError(403, 'forbidden', 'Your current roles do not allow this.'),
  authorCannotApprove: (): ApiError =>
    new ApiError(
      403,
      'author_cannot_approve',
      'Authors cannot approve, sign off, clear, schedule or release their own work.',
    ),
  crossOrigin: (): ApiError =>
    new ApiError(403, 'cross_origin', 'Requests must come from this site.'),
  versionRequired: (): ApiError =>
    new ApiError(428, 'version_required', 'Send the version you are changing in If-Match.'),
  validationFailed: (fields: ErrorFields): ApiError =>
    new ApiError(422, 'validation_failed', 'Please fix the highlighted fields.', { fields }),
  readOnlyFields: (keys: readonly string[]): ApiError =>
    new ApiError(422, 'read_only_fields', 'Some fields are set by the server.', {
      fields: Object.fromEntries(keys.map((key) => [key, 'This field is set by the server.'])),
    }),
  claimsInvalid: (fields: ErrorFields): ApiError =>
    new ApiError(422, 'claims_invalid', 'Some claims do not match the recorded rows.', { fields }),
  invalidIdempotencyKey: (): ApiError =>
    new ApiError(
      422,
      'invalid_idempotency_key',
      'Idempotency-Key must be 1 to 255 visible ASCII characters.',
    ),
  staleVersion: (): ApiError =>
    new ApiError(
      412,
      'stale_version',
      'Someone else changed this item. Reload to see the latest version.',
    ),
  illegalTransition: (from: string, to: string): ApiError =>
    new ApiError(409, 'illegal_transition', `This item cannot move from ${from} to ${to}.`),
  conflict: (code: string, message: string): ApiError => new ApiError(409, code, message),
  storageUnavailable: (message: string): ApiError =>
    new ApiError(503, 'storage_unavailable', message),
};
