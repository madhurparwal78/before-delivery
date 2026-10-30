export type ErrorDetails = Record<string, unknown>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ErrorDetails;

  constructor(status: number, code: string, message: string, details: ErrorDetails = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  body(): { error: { code: string; message: string; details: ErrorDetails } } {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export const errors = {
  crossOrigin: (): ApiError =>
    new ApiError(403, 'cross_origin', 'Cross-origin requests are not accepted.'),
  unauthenticated: (): ApiError =>
    new ApiError(401, 'unauthenticated', 'Sign in to use this.'),
  invalidCredentials: (): ApiError =>
    new ApiError(401, 'invalid_credentials', 'That email and password do not match an account.'),
  tenantOffboarded: (): ApiError =>
    new ApiError(403, 'tenant_offboarded', 'This business has been offboarded.'),
  forbidden: (): ApiError =>
    new ApiError(403, 'forbidden', 'This account cannot use that.'),
  notFound: (): ApiError => new ApiError(404, 'not_found', 'That record is not available.'),
  methodNotAllowed: (): ApiError =>
    new ApiError(405, 'method_not_allowed', 'That method is not allowed on this path.'),
  readOnly: (): ApiError =>
    new ApiError(405, 'read_only', 'Inspection links are read-only.'),
  idempotencyConflict: (): ApiError =>
    new ApiError(409, 'idempotency_conflict', 'This key was already used with different details.'),
  idempotencyKeyRequired: (): ApiError =>
    new ApiError(400, 'idempotency_key_required', 'An Idempotency-Key header is required.'),
  bodyTooLarge: (): ApiError => new ApiError(413, 'body_too_large', 'That request body is too large.'),
  fileTooLarge: (): ApiError => new ApiError(413, 'file_too_large', 'That file is too large.'),
  unsupportedMediaType: (): ApiError =>
    new ApiError(415, 'unsupported_media_type', 'That content type is not accepted.'),
  unsupportedFileType: (): ApiError =>
    new ApiError(415, 'unsupported_file_type', 'Only PDF, JPEG or PNG files are accepted.'),
  validation: (details: Record<string, string>): ApiError =>
    new ApiError(422, 'validation_failed', 'Check the highlighted fields.', details),
  conflict: (code: string, message: string, details: ErrorDetails = {}): ApiError =>
    new ApiError(409, code, message, details),
  gone: (code: string, message: string): ApiError => new ApiError(410, code, message),
  staleVersion: (currentVersion: number): ApiError =>
    new ApiError(412, 'stale_version', 'The policy changed since you opened it.', {
      current_version: currentVersion,
    }),
  billingUnavailable: (): ApiError =>
    new ApiError(503, 'billing_unavailable', 'Billing is unreachable.'),
  storageUnavailable: (): ApiError =>
    new ApiError(503, 'storage_unavailable', 'Document storage is unreachable.'),
  mailUnavailable: (): ApiError => new ApiError(503, 'mail_unavailable', 'Email is unreachable.'),
};
