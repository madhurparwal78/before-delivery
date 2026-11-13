import type { ApiErrorBody } from "../../shared/types.js";

export type ErrorExtra = Omit<ApiErrorBody, "error" | "fields">;

/** Every API failure is raised as one of these and rendered in the one error shape. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string> | null;
  readonly extra: ErrorExtra;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>, extra: ErrorExtra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields ?? null;
    this.extra = extra;
  }
}

export function unauthenticated(): ApiError {
  return new ApiError(401, "unauthenticated", "Sign in to see your register.");
}

export function notFound(): ApiError {
  return new ApiError(404, "not_found", "This record isn't on your register.");
}

export function forbidden(): ApiError {
  return new ApiError(403, "forbidden", "This isn't on your register.");
}

export function conflict(code: string, message: string, extra: ErrorExtra = {}): ApiError {
  return new ApiError(409, code, message, undefined, extra);
}

export function validation(fields: Record<string, string>): ApiError {
  return new ApiError(422, "validation", "Check the fields and try again.", fields);
}

export function unavailable(code: string, message: string, extra: ErrorExtra = {}): ApiError {
  return new ApiError(503, code, message, undefined, extra);
}

export function errorBody(error: ApiError): ApiErrorBody {
  const body: ApiErrorBody = { error: { code: error.code, message: error.message }, ...error.extra };
  if (error.fields !== null) body.fields = error.fields;
  return body;
}
