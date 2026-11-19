import type { ServerResponse } from "node:http";

interface ErrorDetails {
  fields?: Record<string, string>;
  lines?: string[];
  latestVersion?: number;
  authorName?: string;
}

/** Every failure a request can end in; `sendError` is the only place that turns one into a response. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: ErrorDetails,
  ) {
    super(message);
  }
}

export const unauthenticated = (): ApiError => new ApiError(401, "unauthenticated", "Sign in first.");
export const notFound = (): ApiError => new ApiError(404, "not_found", "Not found.");
export const forbidden = (message: string): ApiError => new ApiError(403, "forbidden", message);
export const payloadTooLarge = (limit: number): ApiError =>
  new ApiError(413, "payload_too_large", `The request body is larger than ${limit} bytes.`);
export const validationFailed = (fields: Record<string, string>): ApiError =>
  new ApiError(422, "validation_failed", "Some fields need attention.", { fields });
export const storageUnavailable = (message = "Storage is unavailable. The file was not saved."): ApiError =>
  new ApiError(503, "storage_unavailable", message);
export const liveUnavailable = (): ApiError => new ApiError(503, "live_unavailable", "Live updates are paused.");
export const searchUnavailable = (): ApiError =>
  new ApiError(503, "search_unavailable", "Search is unavailable. Showing recent recipes.");
export const mailUnavailable = (): ApiError =>
  new ApiError(503, "mail_unavailable", "Email could not be sent. Try again.");

/** The one error body: `{"error":{"code","message"}}` plus `details` when the error carries them. */
export const errorBody = (error: ApiError): string =>
  JSON.stringify({ error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } });

export function sendError(res: ServerResponse, error: ApiError): void {
  res.writeHead(error.status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(errorBody(error));
}
