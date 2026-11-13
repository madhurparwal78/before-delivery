// The one error shape every API refusal is built through.
import type { ErrorBody } from "../shared/api";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }

  body(): ErrorBody {
    return { error: { code: this.code, message: this.message, ...(this.fields ? { fields: this.fields } : {}) } };
  }
}

export const notFound = (): ApiError => new ApiError(404, "not_found", "Nothing is published at this address.");
export const methodNotAllowed = (allow: string[]): ApiError =>
  new ApiError(405, "method_not_allowed", "This address does not take that method.", undefined, { Allow: allow.join(", ") });
export const payloadTooLarge = (message = "This request is over its size limit."): ApiError => new ApiError(413, "payload_too_large", message);
export const rateLimited = (message: string, retryAfterSeconds: number): ApiError =>
  new ApiError(429, "rate_limited", message, undefined, { "Retry-After": String(retryAfterSeconds) });
export const unauthenticated = (): ApiError => new ApiError(401, "unauthenticated", "Sign in to do this.");
export const sessionEnded = (): ApiError => new ApiError(401, "session_ended", "This session has ended.");
export const forbidden = (): ApiError => new ApiError(403, "forbidden", "Your role can't do this.");
export const unsupportedMediaType = (): ApiError => new ApiError(415, "unsupported_media_type", "This address does not take that content type.");
export const malformedJson = (): ApiError => new ApiError(400, "malformed_json", "The request body is not valid JSON.");
export const validationFailed = (fields: Record<string, string>): ApiError =>
  new ApiError(422, "validation_failed", Object.values(fields).join(" "), fields);
export const conflict = (code: string, message: string): ApiError => new ApiError(409, code, message);
export const staleEdit = (): ApiError => new ApiError(412, "stale_edit", "This piece changed since you opened it. Check the price and save again.");
export const pieceGone = (): ApiError => new ApiError(410, "piece_gone", "This piece has left the rail.");
export const pageEnded = (): ApiError => new ApiError(410, "page_ended", "This page has ended. Ask the shop for a new link.");
export const storageUnavailable = (message: string): ApiError => new ApiError(503, "storage_unavailable", message);
export const mailUnavailable = (message: string): ApiError => new ApiError(503, "mail_unavailable", message);
