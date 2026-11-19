import { ERROR_MESSAGES, type ErrorCode } from '../shared/copy';

/**
 * Every API error is produced here, through one shape and one precedence
 * order. Routes throw an ApiError; the request pipeline writes the body.
 */
const STATUS_BY_CODE: Record<ErrorCode, number> = {
  payload_too_large: 413,
  unsupported_media_type: 415,
  cross_origin: 403,
  unauthenticated: 401,
  not_found: 404,
  forbidden: 403,
  broadcast_only: 403,
  client_message_id_conflict: 409,
  message_deleted: 410,
  rate_limited: 429,
  stale_version: 412,
  edit_window_closed: 409,
  already_pinned: 409,
  pin_limit: 409,
  already_member: 409,
  schedule_not_pending: 409,
  email_taken: 409,
  cannot_deactivate_self: 409,
  invalid_credentials: 401,
  validation: 422,
  storage_unavailable: 503,
  internal_error: 500,
};

export interface ApiErrorExtras {
  message?: string;
  errors?: Record<string, string>;
  current?: unknown;
  headers?: Record<string, string>;
}

export class ApiError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly errors: Record<string, string> | undefined;
  public readonly current: unknown;
  public readonly headers: Record<string, string>;

  constructor(code: ErrorCode, extras: ApiErrorExtras = {}) {
    super(extras.message ?? ERROR_MESSAGES[code]);
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.errors = extras.errors;
    this.current = extras.current;
    this.headers = extras.headers ?? {};
  }

  body(): Record<string, unknown> {
    const body: Record<string, unknown> = { error: this.code, message: this.message };
    if (this.errors) body['errors'] = this.errors;
    if (this.current !== undefined) body['current'] = this.current;
    return body;
  }
}

export function notFound(): ApiError {
  return new ApiError('not_found');
}

export function forbidden(): ApiError {
  return new ApiError('forbidden');
}

export function validation(errors: Record<string, string>): ApiError {
  return new ApiError('validation', { errors });
}

/** Collects field errors in request order, then throws one validation error. */
export class FieldErrors {
  private readonly entries: Record<string, string> = {};

  add(field: string, copy: string): void {
    if (!(field in this.entries)) this.entries[field] = copy;
  }

  get empty(): boolean {
    return Object.keys(this.entries).length === 0;
  }

  throwIfAny(): void {
    if (!this.empty) throw validation(this.entries);
  }
}
