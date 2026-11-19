/** The single error shape, and the table that builds it. */
import { ERROR_MESSAGES, type ErrorCode } from "../shared/copy.js";

const STATUS_OF: Readonly<Record<ErrorCode, number>> = {
  unauthenticated: 401,
  sign_in_failed: 401,
  cross_origin: 403,
  forbidden: 403,
  not_found: 404,
  read_only: 405,
  unit_unavailable: 409,
  unit_reserved: 409,
  price_changed: 409,
  hold_limit: 409,
  hold_cooldown: 409,
  hold_ended: 409,
  idempotency_key_reused: 409,
  already_released: 409,
  not_released: 409,
  unit_withdrawn: 409,
  upload_in_progress: 409,
  stale_price: 412,
  too_large: 413,
  unsupported_type: 415,
  unsupported_image: 415,
  invalid: 422,
  search_rate_limited: 429,
  hold_attempts: 429,
  upload_unconfirmed: 502,
  search_unavailable: 503,
  storage_unavailable: 503,
  media_unavailable: 503,
  internal: 500,
};

interface ErrorBody {
  readonly error: { readonly code: ErrorCode; readonly message: string; readonly fields?: Record<string, string> };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields: Record<string, string> | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(code: ErrorCode, message?: string, extra: { fields?: Record<string, string>; retryAfterSeconds?: number } = {}) {
    super(message ?? ERROR_MESSAGES[code as keyof typeof ERROR_MESSAGES]);
    this.code = code;
    this.status = STATUS_OF[code];
    this.fields = extra.fields;
    this.retryAfterSeconds = extra.retryAfterSeconds;
  }

  body(): ErrorBody {
    const base = { code: this.code, message: this.message };
    return { error: this.status === 422 ? { ...base, fields: this.fields ?? {} } : base };
  }
}

export const invalid = (fields: Record<string, string>): ApiError => new ApiError("invalid", undefined, { fields });
