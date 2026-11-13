// The one error shape: {"error":"<code>","message":"<sentence>"} plus "fields" for validation.

import type { ApiErrorBody } from "../shared/api.js";

export type FieldErrors = Record<string, string>;

export const UNACCEPTED = "This field is not accepted.";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly fields?: FieldErrors,
    readonly headers?: Readonly<Record<string, string>>) {
    super(message);
  }

  body(): ApiErrorBody {
    return this.fields ? { error: this.code, message: this.message, fields: this.fields } : { error: this.code, message: this.message };
  }
}

export function conflict(code: string, message: string): ApiError {
  return new ApiError(409, code, message);
}

export const NOT_FOUND = (): ApiError => new ApiError(404, "not_found", "That record isn't available.");
export const FORBIDDEN = (): ApiError => new ApiError(403, "forbidden", "Your role can't use this.");
export const INTERNAL = (): ApiError => new ApiError(500, "internal_error", "Something went wrong on our side.");
