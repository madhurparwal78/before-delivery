export type ErrorCode =
  | "payload_too_large"
  | "unauthenticated"
  | "invalid_credentials"
  | "not_found"
  | "forbidden"
  | "idempotency_key_reused"
  | "invalid_transition"
  | "seat_taken"
  | "credential_invalid"
  | "schedule_conflict"
  | "fee_changed"
  | "unsupported_type"
  | "validation"
  | "storage_unavailable";

export const STATUS_BY_CODE: Record<ErrorCode, number> = {
  payload_too_large: 413,
  unauthenticated: 401,
  invalid_credentials: 401,
  not_found: 404,
  forbidden: 403,
  idempotency_key_reused: 409,
  invalid_transition: 409,
  seat_taken: 409,
  credential_invalid: 409,
  schedule_conflict: 409,
  fee_changed: 409,
  unsupported_type: 415,
  validation: 422,
  storage_unavailable: 503,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly fields?: Record<string, string>;
  readonly extra?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, opts?: { fields?: Record<string, string>; extra?: Record<string, unknown> }) {
    super(message);
    this.code = code;
    this.name = "ApiError";
    if (opts?.fields) this.fields = opts.fields;
    if (opts?.extra) this.extra = opts.extra;
  }

  get status(): number {
    return STATUS_BY_CODE[this.code];
  }

  body(): Record<string, unknown> {
    const err: Record<string, unknown> = { code: this.code, message: this.message };
    if (this.fields) err["fields"] = this.fields;
    const out: Record<string, unknown> = { error: err };
    if (this.extra) for (const [k, v] of Object.entries(this.extra)) out[k] = v;
    return out;
  }
}

export function notFound(): ApiError {
  return new ApiError("not_found", "Not found.");
}
