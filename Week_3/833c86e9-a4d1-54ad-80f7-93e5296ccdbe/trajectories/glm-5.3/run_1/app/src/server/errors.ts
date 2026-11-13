export type ApiError = {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string> | undefined;
};

export function err(status: number, body: Record<string, unknown>, headers?: Record<string, string>): ApiError {
  return { status, body, headers };
}

export function validation(fields: Record<string, string>): ApiError {
  return err(422, { error: "validation", fields });
}

export function restricted(reason: { code: string; date?: string | undefined; n?: number | undefined }): ApiError {
  return err(422, { error: "restricted", reason });
}

export function notFound(): ApiError {
  return err(404, { error: "not_found" });
}

export function forbidden(): ApiError {
  return err(403, { error: "forbidden" });
}

export function conflict(code: string, extra?: Record<string, unknown>): ApiError {
  return err(409, { error: code, ...extra });
}

export function gone(code: string, extra?: Record<string, unknown>): ApiError {
  return err(410, { error: code, ...extra });
}

export function unauthorised(code = "unauthorised"): ApiError {
  return err(401, { error: code });
}

export function rateLimited(retryAfterSec: number): ApiError {
  return err(429, { error: "rate_limited" }, { "Retry-After": String(retryAfterSec) });
}

export function tooLarge(): ApiError {
  return err(413, { error: "too_large" });
}

export function unsupportedMedia(): ApiError {
  return err(415, { error: "unsupported_media_type" });
}

export function cardOutcome(outcome: "declined" | "expired" | "unknown" | "step_up" | "wrong_code"): ApiError {
  return err(402, { error: "card", outcome });
}

export function storageUnavailable(): ApiError {
  return err(503, { error: "storage_unavailable" });
}
