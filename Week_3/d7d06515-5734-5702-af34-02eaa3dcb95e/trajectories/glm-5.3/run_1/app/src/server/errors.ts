import { db } from "./db.js";

export type ErrorCode =
  | "body_too_large"
  | "file_too_large"
  | "bad_request"
  | "unauthenticated"
  | "invalid_credentials"
  | "not_found"
  | "link_expired"
  | "link_revoked"
  | "verify_link_expired"
  | "verify_link_replaced"
  | "view_only"
  | "markup_only"
  | "trial_ended"
  | "forbidden"
  | "unverified"
  | "version_conflict"
  | "layer_zero"
  | "layer_current"
  | "layer_locked"
  | "layer_in_use"
  | "folder_not_empty"
  | "trace_not_open"
  | "trace_not_submitted"
  | "issue_resolved"
  | "export_not_ready"
  | "signin_locked"
  | "invite_cooldown"
  | "mail_unavailable"
  | "storage_unavailable";

export const errorStatus: Record<ErrorCode, number> = {
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
  readonly code: ErrorCode;
  readonly status: number;
  readonly extra: Record<string, unknown>;

  constructor(code: ErrorCode, extra: Record<string, unknown> = {}) {
    super(code);
    this.code = code;
    this.status = errorStatus[code];
    this.extra = extra;
  }
}

export function bad(code: ErrorCode, extra?: Record<string, unknown>): ApiError {
  return new ApiError(code, extra);
}

export interface FieldErrors {
  [field: string]: string;
}

export class ValidationError extends Error {
  readonly errors: FieldErrors;
  constructor(errors: FieldErrors) {
    super("validation");
    this.errors = errors;
  }
}

export function validation(errors: FieldErrors): ValidationError {
  return new ValidationError(errors);
}

export async function expectOne<T extends { [k: string]: unknown }>(sql: string, params: unknown[], code: ErrorCode = "not_found"): Promise<T> {
  const row = await db.one<T>(sql, params);
  if (!row) throw bad(code);
  return row;
}
