import type { ApiErrorBody } from '../../shared/api.js';

type ErrorExtra = Omit<ApiErrorBody, 'error' | 'message'>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: ErrorExtra;

  constructor(status: number, code: string, message: string, extra: ErrorExtra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  body(): ApiErrorBody {
    return { error: this.code, message: this.message, ...this.extra };
  }
}

export function crossOrigin(): ApiError {
  return new ApiError(403, 'cross_origin', 'Requests must come from this site.');
}

export function bodyTooLarge(): ApiError {
  return new ApiError(413, 'body_too_large', 'That request body is too large.');
}

export function fileTooLarge(): ApiError {
  return new ApiError(413, 'file_too_large', 'The file is larger than 20,000,000 bytes.');
}

export function unsupportedMediaType(): ApiError {
  return new ApiError(415, 'unsupported_media_type', 'Send this request as JSON.');
}

export function unsupportedFileType(): ApiError {
  return new ApiError(415, 'unsupported_file_type', 'Only PDF, PNG or JPEG files can be filed.');
}

export function unauthenticated(): ApiError {
  return new ApiError(401, 'unauthenticated', 'Sign in to continue.');
}

export function notFound(message = 'That could not be found.'): ApiError {
  return new ApiError(404, 'not_found', message);
}

export function forbidden(): ApiError {
  return new ApiError(403, 'forbidden', "Your role can't take this action.");
}

export function validation(errors: Record<string, string>): ApiError {
  return new ApiError(422, 'validation', 'Check the highlighted fields.', { errors });
}

export function conflict(code: string, message: string, extra: ErrorExtra = {}): ApiError {
  return new ApiError(409, code, message, extra);
}

export function storageUnavailable(): ApiError {
  return new ApiError(503, 'storage_unavailable', 'The score store is offline.');
}

export function idempotencyKeyReused(): ApiError {
  return new ApiError(409, 'idempotency_key_reused', 'That Idempotency-Key was used for a different request.');
}
