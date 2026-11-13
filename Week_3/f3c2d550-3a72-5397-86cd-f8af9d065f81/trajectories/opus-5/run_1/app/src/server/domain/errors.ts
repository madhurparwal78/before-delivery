import { DECK_STATUS } from '../../shared/copy.js';
import type { ApiErrorJson } from '../../shared/types.js';

export type ErrorCode =
  | 'cross_origin'
  | 'too_large'
  | 'unsupported_media_type'
  | 'malformed_json'
  | 'not_found'
  | 'idempotency_key_required'
  | 'idempotency_in_flight'
  | 'idempotency_conflict'
  | 'reference_trashed'
  | 'reference_version_conflict'
  | 'already_trashed'
  | 'not_trashed'
  | 'restore_window_closed'
  | 'already_in_reel'
  | 'reel_full'
  | 'reel_version_conflict'
  | 'reel_empty'
  | 'sheet_not_failed'
  | 'sheet_not_ready'
  | 'validation'
  | 'storage_unavailable';

/**
 * The one order in which the API decides which error to answer with. Lower comes first.
 */
export const ERROR_PRECEDENCE: Record<ErrorCode, number> = {
  cross_origin: 1,
  too_large: 2,
  unsupported_media_type: 3,
  malformed_json: 4,
  not_found: 5,
  idempotency_key_required: 6,
  // 7 is an idempotent replay, which is a success rather than an error.
  idempotency_in_flight: 8,
  idempotency_conflict: 9,
  reference_trashed: 10,
  already_trashed: 10.1,
  not_trashed: 10.2,
  restore_window_closed: 10.3,
  already_in_reel: 10.4,
  reel_full: 10.5,
  reel_empty: 10.6,
  sheet_not_failed: 10.7,
  sheet_not_ready: 10.8,
  reference_version_conflict: 10.9,
  reel_version_conflict: 10.95,
  validation: 11,
  storage_unavailable: 12,
};

const STATUS: Record<ErrorCode, number> = {
  cross_origin: 403,
  too_large: 413,
  unsupported_media_type: 415,
  malformed_json: 400,
  not_found: 404,
  idempotency_key_required: 400,
  idempotency_in_flight: 409,
  idempotency_conflict: 409,
  reference_trashed: 409,
  reference_version_conflict: 409,
  already_trashed: 409,
  not_trashed: 409,
  restore_window_closed: 410,
  already_in_reel: 409,
  reel_full: 409,
  reel_version_conflict: 409,
  reel_empty: 409,
  sheet_not_failed: 409,
  sheet_not_ready: 409,
  validation: 422,
  storage_unavailable: 503,
};

const MESSAGES: Record<ErrorCode, string> = {
  cross_origin: 'This request came from another origin.',
  too_large: 'That request body is too large.',
  unsupported_media_type: 'Send this request as JSON.',
  malformed_json: 'That request body is not valid JSON.',
  not_found: "This reference isn't in your deck.",
  idempotency_key_required: 'Send an Idempotency-Key header of 1 to 64 visible characters.',
  idempotency_in_flight: DECK_STATUS.idempotencyInFlight,
  idempotency_conflict: 'That idempotency key was already used with different content.',
  reference_trashed: 'This reference is in the trash.',
  reference_version_conflict: DECK_STATUS.referenceVersionConflict,
  already_trashed: 'This reference is already in the trash.',
  not_trashed: 'This reference is not in the trash.',
  restore_window_closed: DECK_STATUS.restoreWindowClosed,
  already_in_reel: 'That reference is already in this reel.',
  reel_full: DECK_STATUS.reelFull,
  reel_version_conflict: DECK_STATUS.reelVersionConflict,
  reel_empty: DECK_STATUS.reelEmpty,
  sheet_not_failed: 'Only a failed contact sheet can be tried again.',
  sheet_not_ready: 'That contact sheet is not ready yet.',
  validation: DECK_STATUS.validationFailure,
  storage_unavailable: DECK_STATUS.storageFailure,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: Record<string, string>;

  constructor(code: ErrorCode, options?: { message?: string; fields?: Record<string, string> }) {
    super(options?.message ?? MESSAGES[code]);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS[code];
    if (options?.fields) this.fields = options.fields;
  }

  toJson(): ApiErrorJson {
    const error: ApiErrorJson['error'] = { code: this.code, message: this.message };
    if (this.fields) error.fields = this.fields;
    return { error };
  }
}

export function validationError(fields: Record<string, string>): ApiError {
  return new ApiError('validation', { fields });
}

export function notFound(): ApiError {
  return new ApiError('not_found');
}

/** Keeps the first error by the published precedence. */
export function firstByPrecedence(errors: ApiError[]): ApiError | null {
  let best: ApiError | null = null;
  for (const error of errors) {
    if (!best || ERROR_PRECEDENCE[error.code] < ERROR_PRECEDENCE[best.code]) best = error;
  }
  return best;
}
