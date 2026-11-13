import type { ApiErrorCode } from '../shared/api';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  body_too_large: 413,
  file_too_large: 413,
  bad_request: 400,
  unauthenticated: 401,
  invalid_credentials: 401,
  not_found: 404,
  link_expired: 410,
  link_revoked: 410,
  verify_link_expired: 410,
  verify_link_replaced: 410,
  view_only: 403,
  markup_only: 403,
  trial_ended: 403,
  forbidden: 403,
  unverified: 403,
  version_conflict: 409,
  layer_zero: 409,
  layer_current: 409,
  layer_locked: 409,
  layer_in_use: 409,
  folder_not_empty: 409,
  trace_not_open: 409,
  trace_not_submitted: 409,
  issue_resolved: 409,
  export_not_ready: 409,
  signin_locked: 429,
  invite_cooldown: 429,
  mail_unavailable: 503,
  storage_unavailable: 503,
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly extra: Record<string, unknown>;

  constructor(code: ApiErrorCode, extra: Record<string, unknown> = {}) {
    super(code);
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.extra = extra;
  }

  body(): Record<string, unknown> {
    return { error: this.code, ...this.extra };
  }
}

export class ValidationError extends Error {
  readonly status = 422;
  readonly errors: Record<string, string>;

  constructor(errors: Record<string, string>) {
    super('validation');
    this.errors = errors;
  }

  body(): Record<string, unknown> {
    return { errors: this.errors };
  }
}

export function fail(code: ApiErrorCode, extra: Record<string, unknown> = {}): never {
  throw new ApiError(code, extra);
}

export function invalid(field: string, message: string): never {
  throw new ValidationError({ [field]: message });
}
