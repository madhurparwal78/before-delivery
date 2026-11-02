export interface ErrorFields {
  [field: string]: string;
}

/** Every error leaves the server in the one published error shape. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: ErrorFields | null;

  constructor(status: number, code: string, message: string, fields: ErrorFields | null = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  body(): { error: { code: string; message: string; fields?: ErrorFields } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.fields === null ? {} : { fields: this.fields }),
      },
    };
  }
}

export const errors = {
  payloadTooLarge: (): ApiError =>
    new ApiError(413, 'payload_too_large', 'Request body is too large.'),
  unauthenticated: (): ApiError => new ApiError(401, 'unauthenticated', 'Sign in to continue.'),
  invalidCredentials: (): ApiError =>
    new ApiError(401, 'invalid_credentials', 'Email or password is incorrect.'),
  notFound: (): ApiError => new ApiError(404, 'not_found', 'Not found.'),
  methodNotAllowed: (): ApiError =>
    new ApiError(405, 'method_not_allowed', "This action isn't allowed."),
  forbidden: (): ApiError => new ApiError(403, 'forbidden', "You don't have permission to do that."),
  conflict: (code: string, message: string): ApiError => new ApiError(409, code, message),
  invalidTransition: (assetId: string, from: string, to: string): ApiError =>
    new ApiError(409, 'invalid_transition', `Cannot move ${assetId} from ${from} to ${to}.`),
  validation: (fields: ErrorFields, message = 'Check the highlighted fields.'): ApiError =>
    new ApiError(422, 'validation', message, fields),
  tooDeep: (): ApiError =>
    new ApiError(422, 'validation', 'Request body is nested too deeply.', {}),
  evidenceUnavailable: (): ApiError =>
    new ApiError(
      503,
      'evidence_unavailable',
      'Evidence storage is unreachable. The asset stays in draft; try again shortly.',
    ),
  rangeNotSatisfiable: (): ApiError =>
    new ApiError(416, 'range_not_satisfiable', 'Requested range is outside the evidence file.'),
  idempotencyInProgress: (): ApiError =>
    new ApiError(
      409,
      'idempotency_in_progress',
      'A request with this Idempotency-Key is still in progress. Retry shortly.',
    ),
  idempotencyConflict: (): ApiError =>
    new ApiError(
      409,
      'idempotency_conflict',
      'This Idempotency-Key was already used with a different request.',
    ),
};
