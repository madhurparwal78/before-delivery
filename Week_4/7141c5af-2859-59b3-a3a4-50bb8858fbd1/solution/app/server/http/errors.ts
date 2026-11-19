import { copy } from "../domain/copy.ts";

/** The one error shape: every refusal in the API leaves through this class and `errorBody`. */
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

export function errorBody(error: ApiError): { error: { code: string; message: string; fields?: Record<string, string> } } {
  return { error: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) } };
}

export function notFound(): ApiError {
  return new ApiError(404, "notFound", copy("F-100"));
}

/** 422 on one field; `message` is that field's published copy. */
export function invalid(field: string, message: string, code = "invalid"): ApiError {
  return new ApiError(422, code, message, { [field]: message });
}

export function conflict(code: string, message: string): ApiError {
  return new ApiError(409, code, message);
}

export function stale(code: string, message: string): ApiError {
  return new ApiError(412, code, message);
}

export function unavailable(code: string, message: string): ApiError {
  return new ApiError(503, code, message);
}

/** 429 with Retry-After in whole seconds, at least one. */
export function tooMany(code: string, message: string, until: Date): ApiError {
  const seconds = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000));
  return new ApiError(429, code, message, undefined, { "Retry-After": String(seconds) });
}
