import { ERROR_STATUS, errorMessage, type ErrorCode, type ErrorParams } from './errors.js';

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly extra: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.extra = extra;
  }

  static of<C extends ErrorCode>(code: C, params: ErrorParams[C], extra: Record<string, unknown> = {}): ApiError {
    return new ApiError(code, errorMessage(code, params), extra);
  }

  static validation(errors: Record<string, string>): ApiError {
    return ApiError.of('validation', undefined, { errors });
  }

  body(): Record<string, unknown> {
    return { error: this.code, message: this.message, ...this.extra };
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
