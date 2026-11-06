/**
 * One error constructor builds every error response. It never copies a caught
 * error's text, so no host, driver code, stack frame, path, SQL, environment
 * variable name or credential can reach a response.
 */
export type ErrorCode =
  | 'cross_origin'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'invalid_json'
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'bad_signature'
  | 'stale_signature'
  | 'not_found'
  | 'forbidden'
  | 'not_preparer'
  | 'preparer_cannot_clear'
  | 'preparer_cannot_release'
  | 'clearer_cannot_release'
  | 'invalid_transition'
  | 'version_conflict'
  | 'restatement_open'
  | 'week_out_of_sequence'
  | 'week_not_ended'
  | 'not_latest_week'
  | 'exhibit_not_verified'
  | 'idempotency_conflict'
  | 'tick_id_conflict'
  | 'session_closed'
  | 'range_not_satisfiable'
  | 'validation_failed'
  | 'vault_unavailable'
  | 'internal';

interface ErrorDefinition {
  status: number;
  message: string;
}

const DEFINITIONS: Readonly<Record<ErrorCode, ErrorDefinition>> = {
  cross_origin: { status: 403, message: 'Cross-site requests are not allowed.' },
  payload_too_large: { status: 413, message: 'The request body is too large.' },
  unsupported_media_type: { status: 415, message: 'That content type is not accepted here.' },
  invalid_json: { status: 422, message: 'Request body is not valid JSON.' },
  unauthenticated: { status: 401, message: 'Sign in to continue.' },
  invalid_credentials: { status: 401, message: 'Email or password is incorrect.' },
  bad_signature: { status: 401, message: 'The tick signature is not valid.' },
  stale_signature: { status: 401, message: 'The tick signature is out of date.' },
  not_found: { status: 404, message: 'Not found.' },
  forbidden: { status: 403, message: 'You may not take this action.' },
  not_preparer: { status: 403, message: 'Only the preparer may change this restatement.' },
  preparer_cannot_clear: { status: 403, message: 'The preparer may not review this restatement.' },
  preparer_cannot_release: {
    status: 403,
    message: 'The preparer may not release or withdraw this restatement.',
  },
  clearer_cannot_release: {
    status: 403,
    message: 'The person who cleared this restatement may not release it.',
  },
  invalid_transition: {
    status: 409,
    message: 'This restatement cannot take that action in its current state.',
  },
  version_conflict: { status: 409, message: 'This restatement changed since it was read.' },
  restatement_open: { status: 409, message: 'Another restatement is already open.' },
  week_out_of_sequence: { status: 409, message: 'That is not the next weekly restatement.' },
  week_not_ended: { status: 409, message: 'That holdings week has not ended yet.' },
  not_latest_week: { status: 409, message: 'That is not the latest published restatement.' },
  exhibit_not_verified: { status: 409, message: 'Attach a verified exhibit first.' },
  idempotency_conflict: {
    status: 409,
    message: 'That idempotency key was already used for another restatement.',
  },
  tick_id_conflict: { status: 409, message: 'That tick id is already stored with other values.' },
  session_closed: { status: 409, message: 'The equity session is closed.' },
  range_not_satisfiable: { status: 416, message: 'The requested range cannot be served.' },
  validation_failed: { status: 422, message: 'Some fields need attention.' },
  vault_unavailable: { status: 503, message: 'Filing vault unavailable.' },
  internal: { status: 500, message: 'Something went wrong. Nothing was changed.' },
};

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    fields?: Record<string, string>;
  };
}

export class ApiError extends Error {
  readonly status: number;

  readonly code: ErrorCode;

  readonly fields: Record<string, string> | null;

  readonly extraHeaders: Record<string, string>;

  constructor(
    code: ErrorCode,
    options: { fields?: Record<string, string>; headers?: Record<string, string> } = {},
  ) {
    const definition = DEFINITIONS[code];
    super(definition.message);
    this.name = 'ApiError';
    this.status = definition.status;
    this.code = code;
    this.fields = options.fields ?? null;
    this.extraHeaders = options.headers ?? {};
  }

  body(): ErrorBody {
    const error: ErrorBody['error'] = { code: this.code, message: this.message };
    if (this.fields !== null) error.fields = this.fields;
    return { error };
  }
}

export function fail(
  code: ErrorCode,
  options: { fields?: Record<string, string>; headers?: Record<string, string> } = {},
): ApiError {
  return new ApiError(code, options);
}

export function validationFailure(fields: Record<string, string>): ApiError {
  return new ApiError('validation_failed', { fields });
}
