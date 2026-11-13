// The one error shape every API refusal goes through: {"error","message"} plus the stated extras.

import type { ApiErrorBody } from "../shared/api.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
  }
}

export const unauthenticated = (): ApiError =>
  new ApiError(401, { error: "unauthenticated", message: "Sign in to continue." });

export const notFound = (): ApiError => new ApiError(404, { error: "not_found", message: "Nothing was found at that address." });

export const forbidden = (): ApiError =>
  new ApiError(403, { error: "forbidden", message: "Your role can't take this action." });

export const conflict = (error: string, message: string, extra: Partial<ApiErrorBody> = {}): ApiError =>
  new ApiError(409, { error, message, ...extra });

export const invalid = (errors: Record<string, string>): ApiError =>
  new ApiError(422, { error: "validation", message: "Check the highlighted fields.", errors });

export const programmeClosed = (): ApiError =>
  conflict("programme_closed", "This programme is closed. Its counts and cuts can't change.");

export const storageUnavailable = (): ApiError =>
  new ApiError(503, { error: "storage_unavailable", message: "The score store is offline." });

/** Collects field messages and throws one 422 when any were added. */
export class FieldErrors {
  private readonly errors: Record<string, string> = {};

  add(field: string, message: string): void {
    this.errors[field] ??= message;
  }

  any(): boolean {
    return Object.keys(this.errors).length > 0;
  }

  throwIfAny(): void {
    if (this.any()) throw this.error();
  }

  error(): ApiError {
    return invalid(this.errors);
  }
}
