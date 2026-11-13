// The one published error shape and every refusal that crosses modules.

import type { ApiErrorBody } from "../shared/api";

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
}

// A provider answered in a way the published contract does not cover. It surfaces as a 500 in the one shape.
export class HttpFailure extends Error {}

export function errorBody(error: ApiError): ApiErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.fields ? { fields: error.fields } : {}),
    },
  };
}

export function notFound(): ApiError {
  return new ApiError(404, "not_found", "We can't find that page.");
}

export function forbidden(): ApiError {
  return new ApiError(403, "forbidden", "You don't have access to this.");
}

export function invalid(fields: Record<string, string>): ApiError {
  return new ApiError(422, "invalid", Object.values(fields)[0] ?? "Check the fields.", fields);
}

export function tooLarge(message = "That request is too large."): ApiError {
  return new ApiError(413, "too_large", message);
}

export function conflict(code: string, message: string): ApiError {
  return new ApiError(409, code, message);
}

export function payments503(): ApiError {
  return new ApiError(503, "payments_unavailable", "Payments are unavailable right now. Nothing was charged.");
}

export function reportStore503(): ApiError {
  return new ApiError(503, "report_store_unavailable", "The report store is unavailable right now. Nothing was saved.");
}

export function attachmentStore503(): ApiError {
  return new ApiError(503, "attachment_store_unavailable", "Attachments can't be stored right now. Nothing was sent.");
}

export function refuseWhileClosing(accountState: string): void {
  if (accountState === "closing") throw conflict("account_closing", "This account is closing.");
}
