import { ERRORS, errorCopy, type ErrorCode, type ErrorParams } from "../shared/copy";
import type { ApiErrorBody } from "../shared/types";

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly params: ErrorParams = {},
    readonly extra: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(errorCopy(code, params));
  }

  get status(): number {
    return ERRORS[this.code].status;
  }

  body(): ApiErrorBody {
    return { error: this.code, message: this.message, ...this.extra };
  }
}

/** 422 with the field errors, the one place a validation error is built. */
export function invalid(errors: Record<string, string>): AppError {
  return new AppError("validation", {}, { errors });
}

export function notFound(): AppError {
  return new AppError("not_found");
}

export function forbidden(): AppError {
  return new AppError("forbidden");
}
