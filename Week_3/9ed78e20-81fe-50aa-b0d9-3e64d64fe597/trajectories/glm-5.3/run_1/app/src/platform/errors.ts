export type FieldErrors = Record<string, string>;

export class ApiError extends Error {
  status: number;
  code: string;
  message: string;
  fields?: FieldErrors;
  headers?: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    fields?: FieldErrors,
    headers?: Record<string, string>,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.message = message;
    this.fields = fields;
    this.headers = headers;
  }
}

export const errors = {
  payloadTooLarge: () =>
    new ApiError(413, 'payload_too_large', 'That request is too large.'),
  unsupportedMediaType: (multipart: boolean) =>
    new ApiError(
      415,
      'unsupported_media_type',
      multipart ? 'Send this request as a multipart form.' : 'Send this request as JSON.',
    ),
  unauthenticated: () => new ApiError(401, 'unauthenticated', 'Sign in to continue.'),
  notFoundConsole: () => new ApiError(404, 'not_found', 'No such item.'),
  notFoundPublic: () => new ApiError(404, 'not_found', 'Nothing is published at this address.'),
  gone: (kind: 'item' | 'role') =>
    new ApiError(
      410,
      'gone',
      kind === 'role' ? 'This role has closed.' : 'This item has been withdrawn.',
    ),
  forbidden: () => new ApiError(403, 'forbidden', 'Your current roles do not allow this.'),
  crossOrigin: () => new ApiError(403, 'cross_origin', 'Requests must come from this site.'),
  authorCannotApprove: () =>
    new ApiError(
      403,
      'author_cannot_approve',
      'Authors cannot approve, sign off, clear, schedule or release their own work.',
    ),
  invalidCredentials: () =>
    new ApiError(401, 'invalid_credentials', 'That email and password do not match a staff account.'),
  signinLocked: (retry: number) =>
    new ApiError(
      429,
      'signin_locked',
      `Too many failed sign-ins for this email. Try again in ${retry} seconds.`,
      undefined,
      { 'Retry-After': String(retry) },
    ),
  rateLimited: (retry: number) =>
    new ApiError(
      429,
      'rate_limited',
      `Too many requests. Try again in ${retry} seconds.`,
      undefined,
      { 'Retry-After': String(retry) },
    ),
  versionRequired: () =>
    new ApiError(428, 'version_required', 'Send the version you are changing in If-Match.'),
  staleVersion: () =>
    new ApiError(412, 'stale_version', 'Someone else changed this item. Reload to see the latest version.'),
  validation: (fields: FieldErrors) =>
    new ApiError(422, 'validation_failed', 'Please fix the highlighted fields.', fields),
  readOnlyFields: (fields: FieldErrors) =>
    new ApiError(422, 'read_only_fields', 'Some fields are set by the server.', fields),
  illegalTransition: (from: string, to: string) =>
    new ApiError(409, 'illegal_transition', `This item cannot move from ${from} to ${to}.`),
  idempotencyKeyReused: () =>
    new ApiError(
      409,
      'idempotency_key_reused',
      'This Idempotency-Key was already used for a different request.',
    ),
  idempotencyInProgress: () =>
    new ApiError(
      409,
      'idempotency_in_progress',
      'A request with this Idempotency-Key is still being processed.',
    ),
  alreadySigned: () => new ApiError(409, 'already_signed', 'This sign-off is already recorded.'),
  distinctApproverRequired: () =>
    new ApiError(409, 'distinct_approver_required', 'Safety and legal sign-off must come from different approvers.'),
  invalidIdempotencyKey: () =>
    new ApiError(
      422,
      'invalid_idempotency_key',
      'Idempotency-Key must be 1 to 255 visible ASCII characters.',
    ),
};
