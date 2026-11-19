import type { NextFunction, Request, Response } from "express";

export class ApiError extends Error {
  status: number;
  code: string;
  extra: Record<string, unknown>;

  constructor(status: number, code: string, extra: Record<string, unknown> = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const errors = {
  unauthenticated: () => new ApiError(401, "unauthenticated"),
  notFound: () => new ApiError(404, "not_found"),
  forbidden: () => new ApiError(403, "forbidden"),
  crossOrigin: () => new ApiError(403, "cross_origin"),
  payloadTooLarge: () => new ApiError(413, "payload_too_large"),
  unsupportedMediaType: () => new ApiError(415, "unsupported_media_type"),
  tooManyAttempts: (retryAfter: number) => new ApiError(429, "too_many_attempts", { retry_after: retryAfter }),
  invalidCredentials: () => new ApiError(401, "invalid_credentials"),
  validationFailed: (errors: Record<string, string>) => new ApiError(422, "validation_failed", { errors }),
  conflict: (code: string, extra: Record<string, unknown> = {}) => new ApiError(409, code, extra),
  storageUnavailable: () => new ApiError(503, "storage_unavailable"),
  invalidTransition: (from: string, to: string) => new ApiError(409, "invalid_transition", { from, to }),
};

export function sendApiError(res: Response, err: ApiError): void {
  const body: Record<string, unknown> = { code: err.code };
  for (const [key, value] of Object.entries(err.extra)) {
    body[key] = value;
  }
  res.status(err.status).json(body);
}

export function apiErrorMiddleware(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof ApiError) {
    sendApiError(res, err);
    return;
  }
  const anyReq = req as Request & { tooLarge?: boolean; badContent?: boolean; badJson?: boolean };
  if (anyReq.tooLarge) {
    sendApiError(res, errors.payloadTooLarge());
    return;
  }
  if (anyReq.badContent) {
    sendApiError(res, errors.unsupportedMediaType());
    return;
  }
  if (anyReq.badJson) {
    sendApiError(res, errors.validationFailed({ body: "Invalid JSON body" }));
    return;
  }
  console.error("internal error", err);
  res.status(500).json({ code: "internal_error" });
}
