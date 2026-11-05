import type { AvailabilityItem, Quote } from '../shared/types';

export interface ApiErrorExtra {
  fields?: Record<string, string>;
  alternatives?: AvailabilityItem[];
  quote?: Quote;
  photo_index?: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: ApiErrorExtra = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }

  body(): Record<string, unknown> {
    return { error: { code: this.code, message: this.message }, ...this.extra };
  }
}

export const unauthenticated = (): ApiError => new ApiError(401, 'unauthenticated', 'Sign in to continue.');

export const forbidden = (): ApiError =>
  new ApiError(403, 'forbidden', 'This endpoint is not open to your role.');

export const notFound = (code = 'not_found'): ApiError => new ApiError(404, code, 'Not found.');

export const validationFailed = (fields: Record<string, string>): ApiError =>
  new ApiError(422, 'validation_failed', 'Check the highlighted fields.', { fields });

export const conflict = (code: string, message: string, extra: ApiErrorExtra = {}): ApiError =>
  new ApiError(409, code, message, extra);

export const invalidTransition = (): ApiError =>
  conflict('invalid_transition', 'This contract cannot move that way now.');

export const unavailableConflict = (alternatives: AvailabilityItem[]): ApiError =>
  conflict('unavailable', 'No longer available', { alternatives });

export const idempotencyConflict = (): ApiError =>
  conflict('idempotency_conflict', 'That idempotency key was already used with a different request.');

export const billingUnavailable = (): ApiError =>
  new ApiError(503, 'billing_unavailable', 'Billing is unreachable. Nothing was changed.');

export const storageUnavailable = (): ApiError =>
  new ApiError(503, 'storage_unavailable', 'File storage is unreachable. Nothing was changed.');

export const gone = (code: 'link_expired' | 'link_used'): ApiError =>
  new ApiError(
    410,
    code,
    code === 'link_expired' ? 'This signing link has expired.' : 'This agreement has already been signed.',
  );
