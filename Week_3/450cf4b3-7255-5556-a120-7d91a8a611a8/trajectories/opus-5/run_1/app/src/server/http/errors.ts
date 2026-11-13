import { serverMessage } from '../../shared/copy';
import type { ApiErrorBody } from '../../shared/types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string> | null;
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    fields: Record<string, string> | null = null,
    headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.headers = headers;
  }

  body(): ApiErrorBody {
    const body: ApiErrorBody = { error: this.code, message: this.message };
    if (this.fields !== null) body.fields = this.fields;
    return body;
  }
}

export const payloadTooLarge = (): ApiError =>
  new ApiError(413, 'payload_too_large', serverMessage.payloadTooLarge);

export const unsupportedMediaType = (): ApiError =>
  new ApiError(415, 'unsupported_media_type', serverMessage.unsupportedMediaType);

export const crossOrigin = (): ApiError => new ApiError(403, 'cross_origin', serverMessage.crossOrigin);

export const unauthenticated = (): ApiError =>
  new ApiError(401, 'unauthenticated', serverMessage.unauthenticated);

export const malformedBody = (): ApiError => new ApiError(400, 'malformed_body', serverMessage.malformedBody);

export const idempotencyKeyRequired = (): ApiError =>
  new ApiError(400, 'idempotency_key_required', serverMessage.idempotencyKeyRequired);

export const idempotencyConflict = (): ApiError =>
  new ApiError(409, 'idempotency_conflict', serverMessage.idempotencyConflict);

export const idempotencyInProgress = (): ApiError =>
  new ApiError(409, 'idempotency_in_progress', serverMessage.idempotencyInProgress);

export const notFound = (): ApiError => new ApiError(404, 'not_found', serverMessage.notFound);

export const forbidden = (): ApiError => new ApiError(403, 'forbidden', serverMessage.forbidden);

export const reauthRequired = (): ApiError =>
  new ApiError(403, 'reauth_required', serverMessage.reauthRequired);

export const rateLimited = (retryAfterSeconds: number): ApiError =>
  new ApiError(429, 'rate_limited', serverMessage.rateLimited, null, {
    'retry-after': String(retryAfterSeconds),
  });

export const tooManyAttempts = (retryAfterSeconds: number): ApiError =>
  new ApiError(429, 'too_many_attempts', serverMessage.signinLimit, null, {
    'retry-after': String(retryAfterSeconds),
  });

export const validationFailed = (fields: Record<string, string>): ApiError =>
  new ApiError(422, 'validation_failed', serverMessage.validationFailed, fields);

export const conflict = (code: string, message: string): ApiError => new ApiError(409, code, message);

export const internalError = (): ApiError =>
  new ApiError(500, 'internal_error', serverMessage.internalError);
