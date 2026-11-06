// The one error shape: {"error":{"code","message", ...extra}}. Every refusal is an ApiError thrown in
// precedence order (boundary, authentication, origin, idempotency, not found, role, gone, validation,
// state conflict, credits and caps, provider) and written by `errorBody`.

type ErrorCode =
  | "payload_too_large" | "unsupported_media_type" | "malformed_json"
  | "unauthenticated" | "cross_origin"
  | "idempotency_key_required" | "idempotency_key_reused"
  | "not_found" | "forbidden" | "model_blocked" | "asset_gone"
  | "validation_failed"
  | "job_not_cancellable" | "rate_already_effective" | "policy_version_stale"
  | "endpoint_limit_reached" | "endpoint_not_disabled"
  | "insufficient_credits" | "budget_hard_cap"
  | "storage_unavailable" | "billing_rejected" | "internal_error";

const STATUS: Record<ErrorCode, number> = {
  payload_too_large: 413, unsupported_media_type: 415, malformed_json: 400,
  unauthenticated: 401, cross_origin: 403,
  idempotency_key_required: 400, idempotency_key_reused: 409,
  not_found: 404, forbidden: 403, model_blocked: 403, asset_gone: 410,
  validation_failed: 422,
  job_not_cancellable: 409, rate_already_effective: 409, policy_version_stale: 412,
  endpoint_limit_reached: 409, endpoint_not_disabled: 409,
  insufficient_credits: 402, budget_hard_cap: 429,
  storage_unavailable: 503, billing_rejected: 502, internal_error: 500,
};

const MESSAGES: Record<ErrorCode, string> = {
  payload_too_large: "The request body is larger than this endpoint accepts.",
  unsupported_media_type: "This endpoint does not accept that content type.",
  malformed_json: "The request body is not valid JSON.",
  unauthenticated: "Sign in or send a valid API key.",
  cross_origin: "Browser writes must come from this app's own origin.",
  idempotency_key_required: "Send an Idempotency-Key of 1 to 255 visible ASCII characters.",
  idempotency_key_reused: "This Idempotency-Key was already used with a different request body.",
  not_found: "Nothing was found at this address.",
  forbidden: "Your role cannot do this.",
  model_blocked: "This model is blocked for your team in this context.",
  asset_gone: "That asset has been removed.",
  validation_failed: "Some fields need attention.",
  job_not_cancellable: "This job has already finished and cannot be cancelled.",
  rate_already_effective: "That rate is already in effect and cannot be withdrawn.",
  policy_version_stale: "Someone saved a newer policy version.",
  endpoint_limit_reached: "This team already has 5 endpoints.",
  endpoint_not_disabled: "That endpoint is not disabled.",
  insufficient_credits: "The team does not have enough available credits for this job.",
  budget_hard_cap: "The team reached its hard cap for this budget period.",
  storage_unavailable: "Object storage is unreachable.",
  billing_rejected: "Billing declined the top-up.",
  internal_error: "Something went wrong on the server.",
};

type ErrorExtra = Record<string, string | number | null | Record<string, string>>;

export class ApiError extends Error {
  readonly status: number;

  constructor(readonly code: ErrorCode, readonly extra: ErrorExtra = {}, message: string = MESSAGES[code]) {
    super(message);
    this.status = STATUS[code];
  }
}

export function fail(code: ErrorCode, extra?: ErrorExtra): never {
  throw new ApiError(code, extra);
}

/** A 422 with one message per offending field. */
export function invalid(fields: Record<string, string>): never {
  throw new ApiError("validation_failed", { fields });
}

export function errorBody(error: ApiError): { error: Record<string, unknown> } {
  return { error: { code: error.code, message: error.message, ...error.extra } };
}
