import type { Request, Response, NextFunction } from "express";

/** The one published error ladder. Each ApiError maps to the JSON error shape. */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;
  readonly allow?: string;

  constructor(status: number, code: string, extra: Record<string, unknown> = {}, allow?: string) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
    this.allow = allow;
  }
}

export const errors = {
  notFound: () => new ApiError(404, "not_found"),
  unauthenticated: () => new ApiError(401, "unauthenticated"),
  sessionEnded: () => new ApiError(401, "session_ended"),
  accessRemoved: () => new ApiError(401, "access_removed"),
  forbidden: () => new ApiError(403, "forbidden"),
  invalidCredentials: () => new ApiError(401, "invalid_credentials"),
  methodNotAllowed: (allow: string) => new ApiError(405, "method_not_allowed", {}, allow),
  unsupportedMediaType: () => new ApiError(415, "unsupported_media_type"),
  tooLarge: (limitBytes: number) => new ApiError(413, "too_large", { limitBytes }),
  badJson: () => new ApiError(400, "bad_json"),
  idempotencyKeyRequired: () => new ApiError(400, "idempotency_key_required"),
  idempotencyKeyReused: () => new ApiError(409, "idempotency_key_reused"),
  rateLimited: (retryAfterSeconds: number) => new ApiError(429, "rate_limited", { retryAfterSeconds }),
  validation: (errorsByField: Record<string, string>) => new ApiError(422, "validation", { errors: errorsByField }),
  conflict: (code: string, extra: Record<string, unknown> = {}) => new ApiError(409, code, extra),
  precondition: (code: string, extra: Record<string, unknown> = {}) => new ApiError(412, code, extra),
  gone: (code: string) => new ApiError(410, code),
  billingUnavailable: () => new ApiError(503, "billing_unavailable"),
  storageUnavailable: () => new ApiError(503, "storage_unavailable"),
};

export function sendError(res: Response, err: ApiError): void {
  const body: Record<string, unknown> = { error: err.code, ...err.extra };
  if (err.status === 405 && err.allow) res.setHeader("Allow", err.allow);
  if (err.status === 429) res.setHeader("Retry-After", String(err.extra.retryAfterSeconds));
  if (err.status === 422) {
    res.status(422).json({ error: "validation", errors: err.extra.errors });
    return;
  }
  res.status(err.status).json(body);
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
