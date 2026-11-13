/** The one published error shape. */

import { errorMessage, type ErrorCode, type MessageParams } from '../../shared/messages.js';
import type { ApiErrorBody } from '../../shared/types.js';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  private readonly params: MessageParams;
  private readonly extra: Record<string, unknown>;

  constructor(
    status: number,
    code: ErrorCode,
    params: MessageParams = {},
    extra: Record<string, unknown> = {},
  ) {
    super(errorMessage(code, params));
    this.status = status;
    this.code = code;
    this.params = params;
    this.extra = extra;
  }

  body(): ApiErrorBody {
    return {
      error: this.code,
      message: errorMessage(this.code, this.params),
      ...this.extra,
    } as ApiErrorBody;
  }
}

export function validationFailed(errors: Record<string, string>): ApiError {
  return new ApiError(422, 'validation_failed', {}, { errors });
}

export function notFound(): ApiError {
  return new ApiError(404, 'not_found');
}

export function forbidden(): ApiError {
  return new ApiError(403, 'forbidden');
}

export function signedOut(): ApiError {
  return new ApiError(401, 'signed_out');
}

export function invalidTransition(
  from: string,
  to: string,
  code: 'invalid_transition' | 'payment_pending' | 'label_pending' = 'invalid_transition',
): ApiError {
  return new ApiError(409, code, { state: from }, { from, to });
}

export function rateLimited(retryAfterSeconds: number): ApiError {
  return new ApiError(
    429,
    'rate_limited',
    { seconds: retryAfterSeconds },
    { retry_after: retryAfterSeconds },
  );
}
