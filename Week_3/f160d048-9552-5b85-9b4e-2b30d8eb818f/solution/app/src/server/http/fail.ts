import { ERRORS, messageFor, type ErrorCode } from "../../shared/errors";
import type { FieldErrors } from "../../shared/rules";

/** The only place an API error body is built. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly params: Record<string, string> = {},
    readonly extra: { fields?: FieldErrors; field?: string; retryAfter?: number } = {},
  ) {
    super(code);
  }

  get status(): number {
    return ERRORS[this.code].status;
  }

  body(): Record<string, unknown> {
    return {
      error: this.code,
      message: messageFor(this.code, this.params),
      ...(this.extra.fields ? { fields: this.extra.fields } : {}),
      ...(this.extra.field ? { field: this.extra.field } : {}),
    };
  }

  headers(): Record<string, string> {
    return this.extra.retryAfter === undefined ? {} : { "Retry-After": String(Math.max(1, Math.ceil(this.extra.retryAfter))) };
  }
}

export const refuse = (code: ErrorCode, params: Record<string, string> = {}): ApiError => new ApiError(code, params);
export const invalidFields = (fields: FieldErrors): ApiError => new ApiError("validation_failed", {}, { fields });
