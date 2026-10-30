// The one error shape: {"error":"<code>"}, validation as {"error":"validation_failed","errors":{...}}.

import type { ErrorBody } from "../shared/api.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody,
  ) {
    super(body.error);
  }
}

export const notFound = (): ApiError => new ApiError(404, { error: "not_found" });
export const forbidden = (): ApiError => new ApiError(403, { error: "forbidden" });
export const conflict = (code: string, extra: Omit<ErrorBody, "error"> = {}): ApiError =>
  new ApiError(409, { error: code, ...extra });
export const invalid = (errors: Record<string, string>): ApiError =>
  new ApiError(422, { error: "validation_failed", errors });
export const unavailable = (code: "database_unavailable" | "billing_unavailable" | "storage_unavailable"): ApiError =>
  new ApiError(503, { error: code });

/** Collects field errors and throws them together as one 422. */
export class FieldErrors {
  private readonly errors: Record<string, string> = {};

  add(field: string, code: string): void {
    if (!(field in this.errors)) this.errors[field] = code;
  }

  any(): boolean {
    return Object.keys(this.errors).length > 0;
  }

  error(): ApiError {
    return invalid(this.errors);
  }
}
