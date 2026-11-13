import type { ApiErrorBody, ErrorCode } from '../shared/api.js';

const STATUS: Record<ErrorCode, number> = {
  too_large: 413,
  unauthenticated: 401,
  bad_credentials: 401,
  username_taken: 409,
  rate_limited: 429,
  not_found: 404,
  read_only: 405,
  forbidden: 403,
  stale_match: 409,
  already_resolved: 409,
  stale_preview: 409,
  stale_seeding: 409,
  checkin_closed: 409,
  wrong_state: 409,
  validation: 422,
  roster_invalid: 422,
  storage_unavailable: 503,
};

type Extra = Omit<ApiErrorBody, 'error' | 'message'>;

// The one error type: every refusal leaves the server as {error, message} plus at most one published extra key.
export class ApiError extends Error {
  readonly status: number;
  constructor(readonly code: ErrorCode, message: string, readonly extra: Extra = {}) {
    super(message);
    this.status = STATUS[code];
  }

  body(): ApiErrorBody {
    return { error: this.code, message: this.message, ...this.extra };
  }
}

export function fail(code: ErrorCode, message: string, extra: Extra = {}): never {
  throw new ApiError(code, message, extra);
}
