import { ERROR_MESSAGES } from '../shared/copy';
import type { ApiEntrant, ApiMatch, ErrorBody } from '../shared/types';

export type ErrorCode =
  | 'read_only'
  | 'too_large'
  | 'unauthenticated'
  | 'bad_credentials'
  | 'rate_limited'
  | 'not_found'
  | 'forbidden'
  | 'stale_match'
  | 'already_resolved'
  | 'stale_preview'
  | 'stale_seeding'
  | 'checkin_closed'
  | 'wrong_state'
  | 'username_taken'
  | 'validation'
  | 'roster_invalid'
  | 'storage_unavailable';

const STATUS: Record<ErrorCode, number> = {
  read_only: 405,
  too_large: 413,
  unauthenticated: 401,
  bad_credentials: 401,
  rate_limited: 429,
  not_found: 404,
  forbidden: 403,
  stale_match: 409,
  already_resolved: 409,
  stale_preview: 409,
  stale_seeding: 409,
  checkin_closed: 409,
  wrong_state: 409,
  username_taken: 409,
  validation: 422,
  roster_invalid: 422,
  storage_unavailable: 503,
};

interface Extras {
  fields?: Record<string, string>;
  match?: ApiMatch;
  entrants?: ApiEntrant[];
  errors?: string[];
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly extras: Extras;

  constructor(code: ErrorCode, message: string, extras: Extras = {}) {
    super(message);
    this.code = code;
    this.status = STATUS[code];
    this.extras = extras;
  }

  body(): ErrorBody {
    return { error: this.code, message: this.message, ...this.extras };
  }
}

export const notFound = (message: string = ERROR_MESSAGES.notFoundTournament): AppError =>
  new AppError('not_found', message);
export const forbidden = (message: string = ERROR_MESSAGES.forbiddenTournament): AppError =>
  new AppError('forbidden', message);
export const unauthenticated = (): AppError => new AppError('unauthenticated', ERROR_MESSAGES.unauthenticated);
export const wrongState = (message: string): AppError => new AppError('wrong_state', message);
export const validation = (fields: Record<string, string>): AppError =>
  new AppError('validation', ERROR_MESSAGES.validationFields, { fields });
export const invalid = (message: string): AppError => new AppError('validation', message);
export const storageUnavailable = (): AppError =>
  new AppError('storage_unavailable', ERROR_MESSAGES.storageUnavailable);
