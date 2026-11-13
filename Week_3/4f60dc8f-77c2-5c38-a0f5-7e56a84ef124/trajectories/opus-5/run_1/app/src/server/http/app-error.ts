import { ERROR_COPY, type ErrorCode } from '../../shared/errors.js';

export type FailOptions = { fields?: Record<string, string>; headers?: Record<string, string> };

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields: Record<string, string> | undefined;
  readonly headers: Record<string, string> | undefined;

  constructor(code: ErrorCode, options: FailOptions = {}) {
    super(ERROR_COPY[code].message);
    this.code = code;
    this.status = ERROR_COPY[code].status;
    this.fields = options.fields;
    this.headers = options.headers;
  }
}

export function fail(code: ErrorCode, options?: FailOptions): never {
  throw new AppError(code, options);
}

export function validation(fields: Record<string, string>): never {
  throw new AppError('validation_failed', { fields });
}

export const errorBody = (error: AppError): Record<string, unknown> => ({
  error: error.code,
  message: error.message,
  ...(error.fields ? { fields: error.fields } : {}),
});
