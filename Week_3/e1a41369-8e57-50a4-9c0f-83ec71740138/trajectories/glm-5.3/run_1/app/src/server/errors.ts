/** The error catalogue: one ApiError class with the published shapes. */
export type ApiErrorName =
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'not_found'
  | 'leader_only'
  | 'cross_origin'
  | 'stale_task'
  | 'already_done'
  | 'not_done'
  | 'username_taken'
  | 'already_in_party'
  | 'party_full'
  | 'already_invited'
  | 'invite_expired'
  | 'quest_in_progress'
  | 'not_enough_accepted'
  | 'quest_not_active'
  | 'idempotency_key_reused'
  | 'body_too_large'
  | 'file_too_large'
  | 'unsupported_file_type'
  | 'unsupported_media_type'
  | 'not_enough_gold'
  | 'chat_rate_limited'
  | 'storage_unavailable'
  | 'database_unavailable';

const STATUS: Record<ApiErrorName | 'validation', number> = {
  validation: 422,
  unauthenticated: 401,
  invalid_credentials: 401,
  not_found: 404,
  leader_only: 403,
  cross_origin: 403,
  stale_task: 409,
  already_done: 409,
  not_done: 409,
  username_taken: 409,
  already_in_party: 409,
  party_full: 409,
  already_invited: 409,
  invite_expired: 409,
  quest_in_progress: 409,
  not_enough_accepted: 409,
  quest_not_active: 409,
  idempotency_key_reused: 409,
  body_too_large: 413,
  file_too_large: 413,
  unsupported_file_type: 415,
  unsupported_media_type: 415,
  not_enough_gold: 422,
  chat_rate_limited: 429,
  storage_unavailable: 503,
  database_unavailable: 503,
};

/** Validation answers 422 {"errors":{...}}; its name is internal. */
export const VALIDATION = 'validation' as const;

export class ApiError extends Error {
  readonly status: number;
  readonly kind: ApiErrorName | typeof VALIDATION;
  readonly fieldErrors?: Record<string, string>;

  constructor(kind: ApiErrorName | typeof VALIDATION, fieldErrors?: Record<string, string>) {
    super(kind);
    this.kind = kind;
    this.status = STATUS[kind];
    this.fieldErrors = fieldErrors;
  }

  body(): Record<string, unknown> {
    if (this.kind === VALIDATION || (this.kind as string) === 'not_enough_gold') {
      return { errors: this.fieldErrors ?? {} };
    }
    return { error: this.kind };
  }
}

export function notEnoughGold(): ApiError {
  return new ApiError('not_enough_gold', { gold: 'Not enough gold.' });
}
