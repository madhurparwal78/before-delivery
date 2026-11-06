export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string> | undefined;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  body(): { error: string; message: string; fields?: Record<string, string> } {
    if (this.fields) {
      return { error: this.code, message: this.message, fields: this.fields };
    }
    return { error: this.code, message: this.message };
  }
}

export const apiError = {
  crossOrigin: (): ApiError =>
    new ApiError(403, 'cross_origin', 'Cross-origin requests are not accepted.'),
  unsupportedMediaType: (): ApiError =>
    new ApiError(415, 'unsupported_media_type', 'Request body must be application/json.'),
  payloadTooLarge: (): ApiError =>
    new ApiError(413, 'payload_too_large', 'Request body is larger than 65536 bytes.'),
  unauthenticated: (): ApiError =>
    new ApiError(401, 'unauthenticated', 'Sign in to continue.'),
  invalidCredentials: (): ApiError =>
    new ApiError(401, 'invalid_credentials', 'Email or password is incorrect.'),
  notFound: (): ApiError => new ApiError(404, 'not_found', 'Not found.'),
  notPublished: (): ApiError =>
    new ApiError(404, 'not_published', 'These results are not published yet.'),
  forbidden: (): ApiError =>
    new ApiError(403, 'forbidden', 'Your role may not take this action.'),
  auditImmutable: (): ApiError =>
    new ApiError(405, 'audit_immutable', 'Correction entries are never changed or deleted.'),
  idempotencyKeyReused: (): ApiError =>
    new ApiError(409, 'idempotency_key_reused', 'That idempotency key was used with a different body.'),
  conflict: (code: string, message: string): ApiError => new ApiError(409, code, message),
  staleVersion: (): ApiError =>
    new ApiError(412, 'stale_version', 'Someone else changed this event.'),
  validation: (fields: Record<string, string>, message = 'Check the highlighted fields.'): ApiError =>
    new ApiError(422, 'validation', message, fields),
  unavailable: (code: 'renderer_unavailable' | 'storage_unavailable' | 'mail_unavailable', message: string): ApiError =>
    new ApiError(503, code, message),
  methodNotAllowed: (): ApiError =>
    new ApiError(405, 'method_not_allowed', 'That method is not allowed here.'),
};
