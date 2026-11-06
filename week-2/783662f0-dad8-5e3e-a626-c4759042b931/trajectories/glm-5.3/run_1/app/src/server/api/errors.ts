/** The single error builder for every error response in the API. */

export interface FieldErrors {
  [field: string]: string;
}

export interface ApiError {
  status: number;
  code: string;
  message: string;
  fields?: FieldErrors;
  etag?: string;
  retryAfter?: number;
}

export function apiError(status: number, code: string, message: string, extra?: { fields?: FieldErrors; etag?: string; retryAfter?: number }): ApiError {
  return { status, code, message, ...(extra?.fields !== undefined ? { fields: extra.fields } : {}), ...(extra?.etag !== undefined ? { etag: extra.etag } : {}), ...(extra?.retryAfter !== undefined ? { retryAfter: extra.retryAfter } : {}) };
}

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };
