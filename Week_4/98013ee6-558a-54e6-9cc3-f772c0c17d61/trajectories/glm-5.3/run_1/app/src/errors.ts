import type { Response } from "express";

/** One JSON error shape and one ordering of checks for the whole API (DP-06). */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public extra: Record<string, unknown> = {}
  ) {
    super(code);
  }
}

export const unauthorized = (): ApiError => new ApiError(401, "unauthorized");
export const notFound = (): ApiError => new ApiError(404, "not_found");
export const forbidden = (): ApiError => new ApiError(403, "forbidden");
export const conflict = (code: string, extra: Record<string, unknown> = {}): ApiError =>
  new ApiError(409, code, extra);
export const gone = (code: string): ApiError => new ApiError(410, code);
export const validation = (field: string): ApiError =>
  new ApiError(422, "validation", { field });
export const tooLarge = (maxBytes: number): ApiError =>
  new ApiError(413, "too_large", { max_bytes: maxBytes });
export const unsupportedType = (): ApiError => new ApiError(415, "unsupported_type");
export const storageUnavailable = (): ApiError => new ApiError(503, "storage_unavailable");

export function sendError(res: Response, err: ApiError): void {
  res.status(err.status).json({ error: err.code, ...err.extra });
}

/** A refusals list decides the first failing check in the published order. */
export function firstRefusal(refusals: Array<(() => ApiError) | null>): ApiError {
  for (const r of refusals) if (r) return r();
  throw new Error("no refusal matched");
}

/** Returns the first present refusal or null when all checks pass. */
export function refuseIf(refusals: Array<(() => ApiError) | null>): ApiError | null {
  for (const r of refusals) if (r) return r();
  return null;
}
