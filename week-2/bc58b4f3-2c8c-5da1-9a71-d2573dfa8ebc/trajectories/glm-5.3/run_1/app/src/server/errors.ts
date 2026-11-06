export type ErrorCode =
  | "cross_origin"
  | "payload_too_large"
  | "unsupported_media_type"
  | "unauthenticated"
  | "invalid_credentials"
  | "not_found"
  | "forbidden"
  | "idempotency_key_required"
  | "idempotency_conflict"
  | "invalid_transition"
  | "seat_taken"
  | "already_holding"
  | "calendar_conflict"
  | "late_change"
  | "already_verified"
  | "not_billable"
  | "duplicate_rate"
  | "email_taken"
  | "validation"
  | "storage_unavailable";

const STATUS: Record<ErrorCode, number> = {
  cross_origin: 403,
  payload_too_large: 413,
  unsupported_media_type: 415,
  unauthenticated: 401,
  invalid_credentials: 401,
  not_found: 404,
  forbidden: 403,
  idempotency_key_required: 400,
  idempotency_conflict: 409,
  invalid_transition: 409,
  seat_taken: 409,
  already_holding: 409,
  calendar_conflict: 409,
  late_change: 409,
  already_verified: 409,
  not_billable: 409,
  duplicate_rate: 409,
  email_taken: 409,
  validation: 422,
  storage_unavailable: 503,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly fields?: Record<string, string>;

  constructor(code: ErrorCode, message: string, fields?: Record<string, string>) {
    super(message);
    this.code = code;
    this.fields = fields;
  }

  get status(): number {
    return STATUS[this.code];
  }

  body(): object {
    const error: Record<string, unknown> = { code: this.code, message: this.message };
    if (this.code === "validation" || this.fields) error.fields = this.fields ?? {};
    return { error };
  }
}

export function validationError(fields: Record<string, string>): ApiError {
  return new ApiError("validation", "Check the highlighted fields.", fields);
}
