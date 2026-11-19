const ERROR_STATUS = {
  too_large: 413,
  unauthenticated: 401,
  bad_credentials: 401,
  session_expired: 401,
  rate_limited: 429,
  not_found: 404,
  link_expired: 404,
  link_revoked: 404,
  forbidden: 403,
  branch_locked: 403,
  stale_base: 409,
  op_id_reused: 409,
  username_taken: 409,
  invalid_transition: 409,
  session_ended: 409,
  already_presenting: 409,
  not_ready: 409,
  clipboard_empty: 409,
  quota_exceeded: 409,
  invalid: 422,
  wrong_type: 422,
  invalid_outline: 422,
  root_protected: 422,
  storage_unavailable: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export interface ErrorBody {
  error: ErrorCode;
  message: string;
  fields?: Record<string, string>;
  lines?: string[];
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly fields: Record<string, string> | undefined;
  readonly lines: string[] | undefined;
  readonly headers: Record<string, string> | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    extra: { fields?: Record<string, string>; lines?: string[]; headers?: Record<string, string> } = {},
  ) {
    super(message);
    this.code = code;
    this.fields = extra.fields;
    this.lines = extra.lines;
    this.headers = extra.headers;
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }

  body(): ErrorBody {
    const body: ErrorBody = { error: this.code, message: this.message };
    if (this.fields) body.fields = this.fields;
    if (this.lines) body.lines = this.lines;
    return body;
  }
}

/**
 * The one error precedence order: a request meets these checks in this order and the first failure
 * is the answer. Routes supply a check per stage they need; the dispatcher runs them in this order.
 */
export const STAGES = [
  'body_size', // 413
  'authenticate', // 401
  'rate', // 429
  'resolve', // 404
  'replay', // stored result of a repeated operation group
  'authorize', // 403
  'state', // 409 state conflicts
  'validate', // 422
  'quota', // 409 quota_exceeded
  'services', // 503
] as const;
export type Stage = (typeof STAGES)[number];
