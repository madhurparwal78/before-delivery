import { ERROR_COPY, type ErrorCode } from '../shared/copy.js';

export interface ApiErrorBody {
  error: ErrorCode;
  message: string;
  fields?: Record<string, string>;
  currentRevision?: number;
  retryAfterSeconds?: number;
}

/** Every API error goes through this one shape. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(
    status: number,
    code: ErrorCode,
    extra?: { message?: string; fields?: Record<string, string>; currentRevision?: number; retryAfterSeconds?: number },
  ) {
    const message = extra?.message ?? ERROR_COPY[code];
    super(message);
    this.status = status;
    this.body = { error: code, message };
    if (extra?.fields) this.body.fields = extra.fields;
    if (extra?.currentRevision !== undefined) this.body.currentRevision = extra.currentRevision;
    if (extra?.retryAfterSeconds !== undefined) this.body.retryAfterSeconds = extra.retryAfterSeconds;
  }
}

export const tooLarge = (): ApiError => new ApiError(413, 'too_large');
export const notFound = (message?: string): ApiError => new ApiError(404, 'not_found', { message });
export const forbidden = (): ApiError => new ApiError(403, 'forbidden');
export const emailUnverified = (message: string): ApiError => new ApiError(403, 'email_unverified', { message });
export const conflict = (code: ErrorCode): ApiError => new ApiError(409, code);
export const validation = (fields: Record<string, string>): ApiError => new ApiError(422, 'validation', { fields });
export const storageUnavailable = (): ApiError => new ApiError(503, 'storage_unavailable');
