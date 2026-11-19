import type { ApiErrorBody } from '../../shared/types.js';

/** Every API error travels as this one shape. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string> | undefined;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  body(): ApiErrorBody {
    const body: ApiErrorBody = { error: this.code, message: this.message };
    if (this.fields !== undefined) body.fields = this.fields;
    return body;
  }
}

export const payloadTooLarge = (): ApiError => new ApiError(413, 'payload_too_large', 'The request body is too large.');

export const unsupportedMediaType = (): ApiError =>
  new ApiError(415, 'unsupported_media_type', 'Send this request as application/json.');

export const unauthenticated = (): ApiError => new ApiError(401, 'unauthenticated', 'Sign in to continue.');

export const invalidKey = (): ApiError => new ApiError(401, 'invalid_key', 'That API key is not valid.');

export const notFound = (): ApiError => new ApiError(404, 'not_found', 'That was not found.');

export const forbidden = (): ApiError => new ApiError(403, 'forbidden', 'Your role cannot do that.');

export const crossOrigin = (): ApiError => new ApiError(403, 'cross_origin', 'Cross-origin writes are refused.');

export const conflict = (code: string, message: string): ApiError => new ApiError(409, code, message);

export const validationFailed = (fields: Record<string, string>): ApiError =>
  new ApiError(422, 'validation_failed', 'Some fields need attention.', fields);

export const storageUnavailable = (): ApiError =>
  new ApiError(503, 'storage_unavailable', 'Audio storage is unreachable.');

export const billingUnavailable = (): ApiError =>
  new ApiError(503, 'billing_unavailable', 'Billing is unreachable.');

export const quotaExhausted = (): ApiError =>
  new ApiError(429, 'quota_exhausted', "This project's monthly audio minutes are used up.");
