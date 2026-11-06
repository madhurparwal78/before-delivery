export type ErrorCode =
  | "unauthenticated"
  | "not_found"
  | "link_not_found"
  | "forbidden"
  | "cross_origin"
  | "not_driver"
  | "method_not_allowed"
  | "idempotency_conflict"
  | "illegal_transition"
  | "session_already_live"
  | "session_not_live"
  | "session_paused"
  | "session_in_progress"
  | "already_driving"
  | "baton_taken"
  | "seat_taken"
  | "group_full"
  | "path_taken"
  | "checkpoint_not_saved"
  | "checkpoint_damaged"
  | "restore_superseded"
  | "restore_already_undone"
  | "import_already_applied"
  | "import_plan_stale"
  | "import_plan_expired"
  | "link_used"
  | "link_expired"
  | "link_revoked"
  | "stale_revision"
  | "too_large"
  | "unsupported_media_type"
  | "validation"
  | "import_rejected"
  | "storage_unavailable"
  | "mail_unavailable";

const statusByCode: Record<ErrorCode, number> = {
  unauthenticated: 401,
  not_found: 404,
  link_not_found: 404,
  forbidden: 403,
  cross_origin: 403,
  not_driver: 403,
  method_not_allowed: 405,
  idempotency_conflict: 409,
  illegal_transition: 409,
  session_already_live: 409,
  session_not_live: 409,
  session_paused: 409,
  session_in_progress: 409,
  already_driving: 409,
  baton_taken: 409,
  seat_taken: 409,
  group_full: 409,
  path_taken: 409,
  checkpoint_not_saved: 409,
  checkpoint_damaged: 409,
  restore_superseded: 409,
  restore_already_undone: 409,
  import_already_applied: 409,
  import_plan_stale: 409,
  import_plan_expired: 410,
  link_used: 410,
  link_expired: 410,
  link_revoked: 410,
  stale_revision: 412,
  too_large: 413,
  unsupported_media_type: 415,
  validation: 422,
  import_rejected: 422,
  storage_unavailable: 503,
  mail_unavailable: 503,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly extra: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.status = statusByCode[code];
    this.extra = extra;
  }
}

export function errorBody(err: ApiError): Record<string, unknown> {
  return { error: { code: err.code, message: err.message, ...err.extra } };
}
