// The one published error shape: {"error":"<code>","message":"<text>"} plus named extras.
import type { ApiErrorBody } from "../shared/types.js";

type Extras = Omit<ApiErrorBody, "error" | "message">;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extras: Extras = {},
  ) {
    super(message);
  }

  body(): ApiErrorBody {
    return { error: this.code, message: this.message, ...this.extras };
  }
}

export const unauthenticated = (): ApiError => new ApiError(401, "unauthenticated", "Sign in to continue");
export const notFound = (): ApiError => new ApiError(404, "not_found", "Not found");
export const forbidden = (): ApiError => new ApiError(403, "forbidden", "This role may not do that");
export const invalid = (errors: Record<string, string>): ApiError =>
  new ApiError(422, "validation_failed", "Some fields need attention", { errors });
export const illegalTransition = (extras: Extras = {}): ApiError =>
  new ApiError(409, "illegal_transition", "That change is not allowed from the move's current status", extras);
export const storageUnavailable = (): ApiError => new ApiError(503, "storage_unavailable", "Evidence store unreachable");
export const payloadTooLarge = (): ApiError => new ApiError(413, "payload_too_large", "Request body is too large");
export const unsupportedType = (): ApiError =>
  new ApiError(415, "unsupported_media_type", "Unsupported content type");
export const methodNotAllowed = (message: string): ApiError => new ApiError(405, "method_not_allowed", message);
export const contentMismatch = (): ApiError =>
  new ApiError(415, "unsupported_media_type", "File content does not match its type");
