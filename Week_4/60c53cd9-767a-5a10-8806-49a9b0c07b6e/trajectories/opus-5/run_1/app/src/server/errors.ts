/** The one error shape every API error is built through. */

import { ERROR_STATUS, errorMessage, type ErrorCode } from '../shared/errors';
import type { ApiErrorBody } from '../shared/types';

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: Record<string, string>;
  readonly retryAfterSeconds?: number;

  constructor(
    code: ErrorCode,
    options: {
      fields?: Record<string, string>;
      retryAfterSeconds?: number;
      placeholders?: Record<string, string>;
    } = {},
  ) {
    super(errorMessage(code, options.placeholders));
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.fields = options.fields;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  body(): ApiErrorBody {
    const error: ApiErrorBody['error'] = { code: this.code, message: this.message };
    if (this.status === 422) error.fields = this.fields ?? {};
    return { error };
  }
}

export function invalidFields(fields: Record<string, string>): ApiError {
  return new ApiError('invalid', { fields });
}
