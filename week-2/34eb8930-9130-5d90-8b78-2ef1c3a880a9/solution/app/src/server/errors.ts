import { OpError } from "../shared/model.js";
import type { ErrorCode } from "../shared/types.js";

/** The single error shape (API, Conventions): `{"error":"<code>"}` plus field messages on 422. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly fields?: Record<string, string>) {
    super(code);
  }

  body(): { error: string; fields?: Record<string, string> } {
    return this.fields ? { error: this.code, fields: this.fields } : { error: this.code };
  }

  /** The same body as a socket error frame (API, Socket, Replies): `error` becomes the socket `code`. */
  frame(ref: string | null): { type: "error"; ref: string | null; code: ErrorCode; fields?: Record<string, string> } {
    const { fields } = this.body();
    const frame = { type: "error" as const, ref, code: this.socketCode() };
    return this.status === 422 && fields && Object.keys(fields).length ? { ...frame, fields } : frame;
  }

  /** The same refusal as a socket error code. */
  private socketCode(): ErrorCode {
    if (this.code === "not_joined") return "not_joined";
    const byStatus: Record<number, ErrorCode> = { 404: "not_found", 403: "forbidden", 409: "conflict", 413: "too_large", 422: "invalid" };
    return byStatus[this.status] ?? "conflict";
  }
}

export const notFound = (): ApiError => new ApiError(404, "not_found");
export const forbidden = (): ApiError => new ApiError(403, "forbidden");
export const conflict = (code: string): ApiError => new ApiError(409, code);
export const invalid = (fields: Record<string, string> = {}): ApiError => new ApiError(422, "invalid", fields);
export const storageUnavailable = (): ApiError => new ApiError(503, "storage_unavailable");

/** Every failure as the single error shape: model refusals map to 413 or 422, anything else is internal. */
export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof OpError) return e.code === "too_large" ? new ApiError(413, "too_large") : invalid();
  return new ApiError(500, "internal");
}

/** Throws 422 when any field message was collected. */
export function check(fields: Record<string, string>): void {
  if (Object.keys(fields).length) throw invalid(fields);
}
