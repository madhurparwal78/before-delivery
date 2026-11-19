import type { ApiErrorDto } from '../../shared/types.js';

/** Every error response in the API is built through this one shape. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string> | null;

  constructor(status: number, code: string, fields?: Record<string, string>) {
    super(code);
    this.status = status;
    this.code = code;
    this.fields = fields ?? null;
  }

  toBody(): ApiErrorDto {
    return this.fields === null ? { error: this.code } : { error: this.code, fields: this.fields };
  }
}

export const notFound = (): ApiError => new ApiError(404, 'not_found');
export const unauthenticated = (): ApiError => new ApiError(401, 'unauthenticated');
export const forbidden = (code: string): ApiError => new ApiError(403, code);
export const conflict = (code: string): ApiError => new ApiError(409, code);
export const invalid = (fields: Record<string, string>): ApiError =>
  new ApiError(422, 'validation_failed', fields);
export const cardDeclined = (): ApiError => new ApiError(402, 'card_declined');
export const paymentUnavailable = (): ApiError => new ApiError(503, 'payment_unavailable');
export const storageUnavailable = (): ApiError => new ApiError(503, 'storage_unavailable');
export const notReady = (): ApiError => new ApiError(409, 'not_ready');
