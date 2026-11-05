import type { ErrorCode, ErrorParams, FieldCopyKey } from '../shared/copy.js';
import { errorMessage, fieldMessage } from '../shared/copy.js';

/** The HTTP status each published code answers with. */
const STATUS: Readonly<Record<ErrorCode, number>> = {
  not_found: 404,
  method_not_allowed: 405,
  unsupported_media_type: 415,
  body_too_large: 413,
  unknown_parameter: 400,
  idempotency_key_required: 400,
  idempotency_key_invalid: 400,
  idempotency_key_reused: 409,
  cross_origin: 403,
  unauthenticated: 401,
  invalid_credentials: 401,
  invalid_api_key: 401,
  rate_limited: 429,
  forbidden: 403,
  not_in_plan: 403,
  password_required: 403,
  wrong_password: 403,
  illegal_transition: 409,
  not_ready: 409,
  not_deletable: 409,
  quota_reached: 409,
  read_only: 409,
  visibility_conflict: 409,
  not_failed: 409,
  already_in_collection: 409,
  plan_unchanged: 409,
  edition_sold_out: 409,
  edition_unavailable: 409,
  edition_locked: 409,
  upgrade_not_possible: 409,
  nothing_to_refund: 409,
  licence_refunded: 403,
  derivatives_rebuilding: 409,
  file_too_large: 413,
  content_mismatch: 415,
  unsupported_type: 415,
  type_not_in_plan: 415,
  validation_failed: 422,
  storage_unavailable: 503,
  search_unavailable: 503,
  billing_unavailable: 503,
};

/** The field name the API reports, paired with the copy key that explains it. */
export interface FieldError {
  readonly field: string;
  readonly key: FieldCopyKey;
}

export function fieldError(field: string, key: FieldCopyKey): FieldError {
  return { field, key };
}

/** Every API refusal is this one shape, with the published codes. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly params: ErrorParams;
  readonly fields: readonly FieldError[];
  readonly headers: Readonly<Record<string, string>>;

  constructor(
    code: ErrorCode,
    options: {
      readonly params?: ErrorParams;
      readonly fields?: readonly FieldError[];
      readonly headers?: Readonly<Record<string, string>>;
    } = {},
  ) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS[code];
    this.params = options.params ?? {};
    this.fields = options.fields ?? [];
    this.headers = options.headers ?? {};
  }

  /** The API body: the English copy, with a `fields` map on a 422. */
  body(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      error: this.code,
      message: errorMessage(this.code, 'en', this.params),
    };
    if (this.status === 422) {
      const fields: Record<string, string> = {};
      for (const f of this.fields) fields[f.field] = fieldMessage(f.key, 'en');
      out.fields = fields;
    }
    return out;
  }
}

export function notFound(): ApiError {
  return new ApiError('not_found');
}

export function methodNotAllowed(allow: readonly string[]): ApiError {
  return new ApiError('method_not_allowed', { headers: { Allow: allow.join(', ') } });
}

export function validationFailed(fields: readonly FieldError[]): ApiError {
  return new ApiError('validation_failed', { fields });
}

export function unknownParameter(name: string): ApiError {
  return new ApiError('unknown_parameter', { params: { name } });
}

export function rateLimited(seconds: number): ApiError {
  return new ApiError('rate_limited', {
    params: { seconds },
    headers: { 'Retry-After': String(seconds) },
  });
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
