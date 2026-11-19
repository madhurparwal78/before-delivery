export const ERROR_CODES = [
  'method_not_allowed',
  'payload_too_large',
  'unsupported_media_type',
  'cross_origin',
  'unauthenticated',
  'invalid_credentials',
  'invalid_signature',
  'stale_timestamp',
  'not_found',
  'forbidden',
  'workspace_read_only',
  'version_conflict',
  'already_scheduled',
  'already_member',
  'email_taken',
  'cannot_remove_owner',
  'billing_unavailable',
  'invitation_used',
  'idempotency_key_required',
  'idempotency_key_mismatch',
  'not_a_task_export',
  'too_many_rows',
  'not_a_calendar',
  'day_in_past',
  'estimate_required',
  'crosses_midnight',
  'validation',
  'bad_request',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const STATUS_FOR_CODE: Record<ErrorCode, number> = {
  method_not_allowed: 405,
  payload_too_large: 413,
  unsupported_media_type: 415,
  cross_origin: 403,
  unauthenticated: 401,
  invalid_credentials: 401,
  invalid_signature: 401,
  stale_timestamp: 401,
  not_found: 404,
  forbidden: 403,
  workspace_read_only: 402,
  version_conflict: 409,
  already_scheduled: 409,
  already_member: 409,
  email_taken: 409,
  cannot_remove_owner: 409,
  billing_unavailable: 503,
  invitation_used: 410,
  idempotency_key_required: 400,
  idempotency_key_mismatch: 422,
  not_a_task_export: 422,
  too_many_rows: 422,
  not_a_calendar: 422,
  day_in_past: 422,
  estimate_required: 422,
  crosses_midnight: 422,
  validation: 422,
  bad_request: 400,
};

export interface ErrorBody {
  error: ErrorCode;
  message: string;
  fields?: Record<string, string>;
  current?: unknown;
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: Record<string, string>;
  readonly current?: unknown;

  constructor(code: ErrorCode, message: string, extra?: { fields?: Record<string, string>; current?: unknown }) {
    super(message);
    this.code = code;
    this.status = STATUS_FOR_CODE[code];
    this.fields = extra?.fields;
    this.current = extra?.current;
  }
}

export const errorBody = (e: ApiError): ErrorBody => {
  const body: ErrorBody = { error: e.code, message: e.message };
  if (e.fields !== undefined && Object.keys(e.fields).length > 0) body.fields = e.fields;
  if (e.current !== undefined) body.current = e.current;
  return body;
};

/** The single mapping from an API error code to the human reason used in announcements. */
export const REASON_TEXT: Record<string, string> = {
  version_conflict: 'it was changed on another device',
  workspace_read_only: 'this workspace is read-only',
  day_in_past: 'that day has already passed',
  already_scheduled: "it's already on the calendar",
  estimate_required: 'add an estimate first',
  crosses_midnight: 'it would run past midnight',
};

export const reasonText = (code: string | undefined): string =>
  (code !== undefined && REASON_TEXT[code] !== undefined) ? REASON_TEXT[code] : 'the server didn\u2019t respond';
