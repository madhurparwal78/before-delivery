import type { ServerResponse } from "node:http";

// The one error body shape: {"error":"<code>"} plus the fields named for that code (brief: API).
// Every refusal is one of these helpers; `sendError` alone writes them to the response.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: { error: string } & Record<string, unknown>,
    readonly headers: Record<string, string> = {},
  ) {
    super(body.error);
  }
}

// Precedence steps 1-3, owned by the router.
export const bodyTooLarge = (limitBytes: number): ApiError => new ApiError(413, { error: "body_too_large", limitBytes });
export const sessionEnded = (): ApiError => new ApiError(401, { error: "session_ended" });
export const accessRemoved = (): ApiError => new ApiError(403, { error: "access_removed" });
export const invalidCredentials = (): ApiError => new ApiError(401, { error: "invalid_credentials" });

// 5 not found, 6 role, 7 state.
export const notFound = (): ApiError => new ApiError(404, { error: "not_found" });
export const forbidden = (): ApiError => new ApiError(403, { error: "forbidden" });
export const conflict = (error: string, extra: Record<string, unknown> = {}): ApiError =>
  new ApiError(409, { error, ...extra });
export const illegalTransition = (from: string, action: string): ApiError =>
  new ApiError(409, { error: "illegal_transition", from, action });
export const staleVersion = (savedBy: string, savedAt: string): ApiError =>
  new ApiError(412, { error: "stale_version", savedBy, savedAt });

// 8 validation, 9 rate limit, 10 provider outage.
export const badRequest = (): ApiError => new ApiError(400, { error: "bad_request" });
export const validation = (errors: Record<string, string>): ApiError =>
  new ApiError(422, { error: "validation", errors });
export const fileTooLarge = (limitBytes: number): ApiError =>
  new ApiError(413, { error: "file_too_large", limitBytes });
export const rateLimited = (retryAfterSeconds: number): ApiError =>
  new ApiError(429, { error: "rate_limited", retryAfterSeconds }, { "Retry-After": String(retryAfterSeconds) });
export const billingUnavailable = (): ApiError => new ApiError(503, { error: "billing_unavailable" });
export const storageUnavailable = (): ApiError => new ApiError(503, { error: "storage_unavailable" });

/** An unexpected failure; the cause is logged, never sent. */
export const internalError = (): ApiError => new ApiError(500, { error: "internal" });

export function sendError(res: ServerResponse, error: ApiError): void {
  res.writeHead(error.status, {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    ...error.headers,
  });
  res.end(JSON.stringify(error.body));
}
