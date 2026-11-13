import type { ApiErrorBody, ErrorCode, Quote } from '../../shared/types.js';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  payload_too_large: 413,
  unauthenticated: 401,
  invalid_credentials: 401,
  not_found: 404,
  forbidden: 403,
  idempotency_key_reused: 409,
  invalid_transition: 409,
  seat_taken: 409,
  credential_invalid: 409,
  schedule_conflict: 409,
  fee_changed: 409,
  unsupported_type: 415,
  validation: 422,
  storage_unavailable: 503,
};

const MESSAGE_BY_CODE: Record<ErrorCode, string> = {
  payload_too_large: 'Request body is too large.',
  unauthenticated: 'Sign in to continue.',
  invalid_credentials: 'Email or password is incorrect.',
  not_found: 'Not found.',
  forbidden: 'Your role cannot do that.',
  idempotency_key_reused: 'That idempotency key was already used for a different action.',
  invalid_transition: 'This request cannot change that way.',
  seat_taken: 'Another interpreter confirmed that seat first.',
  credential_invalid: 'Your credential is not verified through this job date.',
  schedule_conflict: 'You already hold a seat that overlaps this job.',
  fee_changed: 'The cancellation fee has changed.',
  unsupported_type: 'Unsupported content type.',
  validation: 'Some fields need attention.',
  storage_unavailable: 'Certificate storage is unreachable.',
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: Record<string, string>;
  readonly quote?: Quote;

  constructor(code: ErrorCode, options: { fields?: Record<string, string>; quote?: Quote; message?: string } = {}) {
    super(options.message ?? MESSAGE_BY_CODE[code]);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    if (options.fields) this.fields = options.fields;
    if (options.quote) this.quote = options.quote;
  }

  body(): ApiErrorBody {
    const error: ApiErrorBody['error'] = { code: this.code, message: this.message };
    if (this.fields) error.fields = this.fields;
    if (this.quote) error.quote = this.quote;
    return { error };
  }
}

export const notFound = (): ApiError => new ApiError('not_found');
export const forbidden = (): ApiError => new ApiError('forbidden');
export const unauthenticated = (): ApiError => new ApiError('unauthenticated');

export function validationError(fields: Record<string, string>): ApiError {
  return new ApiError('validation', { fields });
}
