import type { ServerResponse } from "node:http";
import type { ApiErrorBody, FieldError } from "../shared/api";

/** Every failure a request can end in; `sendError` is the only place that turns one into a response. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Partial<ApiErrorBody> = {},
  ) {
    super(message);
  }
}

export const unauthenticated = (): ApiError => new ApiError(401, "unauthenticated", "Sign in to continue.");
export const notFound = (): ApiError => new ApiError(404, "not_found", "Notebook not found.");
export const forbidden = (): ApiError => new ApiError(403, "forbidden", "Your role does not allow this.");
export const crossOrigin = (): ApiError => new ApiError(403, "cross_origin", "Cross-origin requests are refused.");
export const tooLarge = (message: string): ApiError => new ApiError(413, "too_large", message);
export const conflict = (code: string, message: string, extra: Partial<ApiErrorBody> = {}): ApiError =>
  new ApiError(409, code, message, extra);
export const validationFailed = (errors: FieldError[]): ApiError =>
  new ApiError(422, "validation_failed", "Some fields are not valid.", { errors });
export const storageUnavailable = (): ApiError =>
  new ApiError(503, "storage_unavailable", "Storage is unavailable. Nothing was changed.");
export const searchUnavailable = (): ApiError => new ApiError(503, "search_unavailable", "Search is unavailable.");
export const mailUnavailable = (): ApiError =>
  new ApiError(503, "mail_unavailable", "Email is unavailable. Nothing was changed.");

/** The one error body: `{"error","message"}` plus the extra fields a row names. */
export const errorBody = (error: ApiError): string => JSON.stringify({ error: error.code, message: error.message, ...error.extra });

export function sendError(res: ServerResponse, error: ApiError): void {
  res.writeHead(error.status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(errorBody(error));
}
