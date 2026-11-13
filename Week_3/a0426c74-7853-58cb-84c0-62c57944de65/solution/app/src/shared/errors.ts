import * as copy from './copy.ts';
import { ERROR_CODES, type ApiErrorBody, type ErrorCode } from './types.ts';

const ERROR_STATUS: Record<ErrorCode, number> = {
  too_large: 413, cross_origin: 403, unauthenticated: 401, rate_limited: 429, not_found: 404, forbidden: 403,
  read_only: 403, sheet_locked: 403, layer_locked: 403, not_ball_in_court: 403, stale_base: 409, illegal_transition: 409,
  rfi_open: 409, out_of_order: 409, review_voided: 409, review_expired: 409, undo_superseded: 409, nothing_to_undo: 409,
  nothing_to_redo: 409, username_taken: 409, quota_exceeded: 409, not_ready: 409, link_expired: 410, link_revoked: 410,
  wrong_type: 422, parse_failed: 422, invalid: 422, storage_unavailable: 503,
};

/** Every API error is one of these: the one error shape carrying a published code. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly fields?: Record<string, string>;
  readonly lines?: string[];

  constructor(code: ErrorCode, message: string, extra: { fields?: Record<string, string>; lines?: string[] } = {}) {
    super(message);
    this.code = code;
    this.fields = extra.fields;
    this.lines = extra.lines;
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }

  toBody(): ApiErrorBody {
    return {
      error: this.code,
      message: this.message,
      ...(this.fields ? { fields: this.fields } : {}),
      ...(this.lines ? { lines: this.lines } : {}),
    };
  }
}

/** A refusal that names no field. */
export const invalid = (message: string): ApiError => new ApiError('invalid', message);

/** A validation error that names the field and carries its sentence both as `message` and in `fields`. */
export function fieldError(field: string, message: string = copy.invalidValue(field)): ApiError {
  return new ApiError('invalid', message, { fields: { [field]: message } });
}

/** A validation error for several fields at once; `message` is the sentence of the first. */
export function fieldsError(fields: Record<string, string>): ApiError {
  return new ApiError('invalid', Object.values(fields)[0], { fields });
}

/**
 * The answer to a fault the server did not foresee (a dependency failing in a way the rules do not name): the request could not be
 * completed, so it is the published 503 code. The cause is logged.
 */
export const serverFault = (): ApiError => new ApiError('storage_unavailable', copy.SERVER_FAULT);

/** Whichever of two errors the published order puts first (the first one when they have the same code). */
export const earlier = (a: ApiError, b: ApiError): ApiError => (ERROR_CODES.indexOf(b.code) < ERROR_CODES.indexOf(a.code) ? b : a);

/** Picks the error that the published order puts first. */
export function firstByOrder(errors: readonly ApiError[]): ApiError | null {
  return errors.reduce<ApiError | null>((best, error) => (best === null ? error : earlier(best, error)), null);
}
