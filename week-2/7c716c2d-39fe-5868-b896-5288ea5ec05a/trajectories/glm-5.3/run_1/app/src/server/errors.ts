export const errorCodes = {
  unauthenticated: 401,
  invalid_credentials: 401,
  forbidden: 403,
  cross_origin: 403,
  not_in_room: 403,
  knock_required: 403,
  not_author: 403,
  not_found: 404,
  validation: 422,
  too_large: 413,
  unsupported_media_type: 415,
  email_taken: 409,
  illegal_transition: 409,
  open_sub_issues: 409,
  cycle_closed: 409,
  version_conflict: 412,
  idempotency_conflict: 409,
  room_open: 409,
  room_empty: 409,
  already_inside: 409,
  knock_expired: 409,
  knock_answered: 409,
  workspace_full: 409,
  invite_pending: 409,
  already_member: 409,
  already_in_workspace: 409,
  invite_expired: 409,
  invite_revoked: 409,
  invite_accepted: 409,
  invite_not_pending: 409,
  seats_below_active: 409,
  owner_required: 409,
  database_unavailable: 503,
  storage_unavailable: 503,
  billing_unavailable: 503,
} as const;

export type ErrorCode = keyof typeof errorCodes;

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields: Record<string, string> | null;
  /** The stored doc carried alongside a version_conflict. */
  current: unknown = null;

  constructor(code: ErrorCode, message: string, fields?: Record<string, string>) {
    super(message);
    this.code = code;
    this.status = errorCodes[code];
    this.fields = fields && Object.keys(fields).length > 0 ? fields : null;
  }
}

export function errorBody(err: ApiError): Record<string, unknown> {
  const error: Record<string, unknown> = { code: err.code, message: err.message };
  if (err.fields) error.fields = err.fields;
  const body: Record<string, unknown> = { error };
  if (err.code === "version_conflict" && err.current !== null) body.current = err.current;
  return body;
}
