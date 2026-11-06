// The one error type and the one place that turns it into a response (brief: Error shape).
import type { ServerResponse } from "node:http";
import type { ApiErrorBody } from "../../shared/api.js";
import type { FieldErrors } from "../domain/validate.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Omit<ApiErrorBody, "error" | "message"> = {},
  ) {
    super(message);
  }
}

export const notFound = (): ApiError => new ApiError(404, "not_found", "Nothing was found at that address.");
export const unauthenticated = (): ApiError => new ApiError(401, "unauthenticated", "Sign in to continue.");

function validation(errors: FieldErrors): ApiError {
  return new ApiError(422, "validation", "Check these fields", { errors });
}

/** Throws the 422 when any field failed. */
export function assertValid(errors: FieldErrors): void {
  if (Object.keys(errors).length > 0) throw validation(errors);
}

function errorBody(error: ApiError): ApiErrorBody {
  return { error: error.code, message: error.message, ...error.extra };
}

export function sendError(res: ServerResponse, error: unknown): void {
  const apiError =
    error instanceof ApiError ? error : new ApiError(500, "internal", "Something went wrong on our side. Try again.");
  if (!(error instanceof ApiError)) console.error(error);
  const payload = JSON.stringify(errorBody(apiError));
  res.writeHead(apiError.status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}
