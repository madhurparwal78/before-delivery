// The one error contract: every API error body is built by ApiError.body().
import type { ApiErrorBody } from "../../shared/api.js";

export const NO_SUCH_RECORD = "No such record in this workspace.";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> | null = null,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }

  body(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, ...this.extra, ...(this.fields ? { fields: this.fields } : {}) } };
  }
}

export const notFound = (): ApiError => new ApiError(404, "not_found", "Nothing exists at this address.");
export const forbidden = (message = "Your role cannot do this."): ApiError => new ApiError(403, "forbidden", message);
export const unauthenticated = (): ApiError => new ApiError(401, "unauthenticated", "Sign in to continue.");
export const storageUnavailable = (): ApiError =>
  new ApiError(503, "storage_unavailable", "Object storage is unavailable. Try again in a minute.");
export const conflict = (code: string, message: string, extra: Record<string, unknown> = {}): ApiError =>
  new ApiError(409, code, message, null, extra);
export const invalid = (fields: Record<string, string>): ApiError =>
  new ApiError(422, "validation_failed", "Some fields need attention.", fields);
