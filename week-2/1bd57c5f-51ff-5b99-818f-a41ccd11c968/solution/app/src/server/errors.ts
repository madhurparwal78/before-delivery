import { CATALOGUE, type ErrorCode } from "../shared/catalogue";
import type { ErrorBody } from "../shared/domain";

/** Every failure leaves the server as one of these, in the single error shape. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly fields?: Record<string, string>,
    readonly extra?: Record<string, unknown>,
  ) {
    super(CATALOGUE[code].message);
  }

  get status(): number {
    return CATALOGUE[this.code].status;
  }

  body(): ErrorBody & Record<string, unknown> {
    return {
      error: this.code,
      message: CATALOGUE[this.code].message,
      ...(this.fields ? { fields: this.fields } : {}),
      ...this.extra,
    };
  }
}

export function fail(code: ErrorCode, extra?: Record<string, unknown>): never {
  throw new ApiError(code, undefined, extra);
}

export function invalid(fields: Record<string, string>): never {
  throw new ApiError("validation", fields);
}
