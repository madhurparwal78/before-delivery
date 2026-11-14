
/** Every error body the API sends is built here. */

export interface ApiReply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

type ErrorCode = "not_found" | "method_not_allowed" | "unsupported_media_type" | "too_large" | "invalid_json" | "file_unavailable";

const STATUS: Record<ErrorCode, number> = {
  not_found: 404,
  method_not_allowed: 405,
  unsupported_media_type: 415,
  too_large: 413,
  invalid_json: 400,
  file_unavailable: 503,
};

export function apiError(code: ErrorCode, headers?: Record<string, string>): ApiReply {
  return { status: STATUS[code], body: { error: code }, ...(headers ? { headers } : {}) };
}

export function methodNotAllowed(allowed: string[]): ApiReply {
  return apiError("method_not_allowed", { Allow: allowed.join(", ") });
}

export function fieldErrors(errors: Partial<Record<string, string>>): ApiReply {
  return { status: 422, body: { errors } };
}

export function rateLimited(retryAfterSeconds: number): ApiReply {
  return { status: 429, body: { error: "rate_limited", retry_after_seconds: retryAfterSeconds }, headers: { "Retry-After": String(retryAfterSeconds) } };
}

export function intakeFailed(reference: string): ApiReply {
  return { status: 502, body: { reference, status: "intake_failed", error: "intake_unavailable" } };
}

export function unavailable(): ApiReply {
  return { status: 503, body: { status: "unavailable" } };
}
