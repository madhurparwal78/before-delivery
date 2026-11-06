// The one error shape and the one table of codes to HTTP statuses.
import type { ApiErrorBody } from "../shared/api.js";

const ERROR_STATUS = {
  bad_json: 400,
  idempotency_key_required: 400,
  unauthenticated: 401,
  invalid_credentials: 401,
  forbidden: 403,
  cross_origin: 403,
  not_found: 404,
  invalid_transition: 409,
  already_started: 409,
  seat_taken: 409,
  offer_window_closed: 409,
  not_yet_ended: 409,
  already_submitted: 409,
  fee_changed: 409,
  idempotency_conflict: 409,
  offer_closed: 410,
  payload_too_large: 413,
  unsupported_media_type: 415,
  validation: 422,
  gate_failed: 422,
  internal: 500,
  billing_unavailable: 503,
  storage_unavailable: 503,
} as const;

type ErrorCode = keyof typeof ERROR_STATUS;
type Extra = Omit<ApiErrorBody["error"], "code" | "message">;

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  bad_json: "The request body is not valid JSON.",
  idempotency_key_required: "Send an Idempotency-Key header of 1 to 128 visible ASCII characters.",
  unauthenticated: "Sign in first.",
  invalid_credentials: "That email and passcode do not match.",
  forbidden: "Your role cannot do this.",
  cross_origin: "Requests from another origin are refused.",
  not_found: "Not found.",
  invalid_transition: "That is not allowed in the current state.",
  already_started: "This assignment has started and can no longer be cancelled.",
  seat_taken: "That seat is already taken.",
  offer_window_closed: "Too late to send an offer for this seat.",
  not_yet_ended: "You can submit after the assignment ends.",
  already_submitted: "A timesheet was already submitted for this seat.",
  fee_changed: "The charge has changed.",
  idempotency_conflict: "That Idempotency-Key was already used with a different body.",
  offer_closed: "This offer is no longer open.",
  payload_too_large: "The request body is too large.",
  unsupported_media_type: "That file type is not supported.",
  validation: "Check the highlighted fields.",
  gate_failed: "A dispatch gate failed.",
  internal: "Something went wrong on our side.",
  billing_unavailable: "Billing is unreachable.",
  storage_unavailable: "File storage is unreachable.",
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly extra: Extra;

  constructor(code: ErrorCode, extra: Extra = {}, message: string = DEFAULT_MESSAGES[code]) {
    super(message);
    this.code = code;
    this.extra = extra;
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }

  toBody(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, ...this.extra } };
  }
}

/** A validation error listing every failing field. */
export function invalid(fields: Record<string, string>): ApiError {
  return new ApiError("validation", { fields });
}
