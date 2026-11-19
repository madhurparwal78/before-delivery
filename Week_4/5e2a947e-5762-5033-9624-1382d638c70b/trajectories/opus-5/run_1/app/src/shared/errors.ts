export type ErrorCode =
  | 'too_large'
  | 'unauthenticated'
  | 'bad_credentials'
  | 'session_expired'
  | 'rate_limited'
  | 'not_found'
  | 'link_expired'
  | 'link_revoked'
  | 'forbidden'
  | 'branch_locked'
  | 'stale_base'
  | 'op_id_reused'
  | 'username_taken'
  | 'invalid_transition'
  | 'session_ended'
  | 'already_presenting'
  | 'not_ready'
  | 'clipboard_empty'
  | 'quota_exceeded'
  | 'invalid'
  | 'wrong_type'
  | 'invalid_outline'
  | 'root_protected'
  | 'storage_unavailable';

export const ERROR_STATUS: Record<ErrorCode, number> = {
  too_large: 413,
  unauthenticated: 401,
  bad_credentials: 401,
  session_expired: 401,
  rate_limited: 429,
  not_found: 404,
  link_expired: 404,
  link_revoked: 404,
  forbidden: 403,
  branch_locked: 403,
  stale_base: 409,
  op_id_reused: 409,
  username_taken: 409,
  invalid_transition: 409,
  session_ended: 409,
  already_presenting: 409,
  not_ready: 409,
  clipboard_empty: 409,
  quota_exceeded: 409,
  invalid: 422,
  wrong_type: 422,
  invalid_outline: 422,
  root_protected: 422,
  storage_unavailable: 503,
};

/**
 * One precedence order for the whole API. A smaller rank is answered first.
 * Replay of a seen operation group sits between 404 and 403 and is handled by
 * the operations route itself rather than by an error code.
 */
export const ERROR_PRECEDENCE: ErrorCode[] = [
  'too_large',
  'unauthenticated',
  'bad_credentials',
  'session_expired',
  'rate_limited',
  'not_found',
  'link_expired',
  'link_revoked',
  'forbidden',
  'branch_locked',
  'stale_base',
  'op_id_reused',
  'username_taken',
  'invalid_transition',
  'session_ended',
  'already_presenting',
  'not_ready',
  'clipboard_empty',
  'invalid',
  'wrong_type',
  'invalid_outline',
  'root_protected',
  'quota_exceeded',
  'storage_unavailable',
];

export function errorRank(code: ErrorCode): number {
  return ERROR_PRECEDENCE.indexOf(code);
}

export interface ErrorBody {
  error: ErrorCode;
  message: string;
  fields?: Record<string, string>;
  lines?: string[];
}

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  too_large: 'That upload is larger than the limit.',
  unauthenticated: 'Sign in to continue.',
  bad_credentials: 'Wrong username or password.',
  session_expired: 'Your session ended. Sign in again to keep your changes.',
  rate_limited: 'Too many requests. Try again in a minute.',
  not_found: 'That topic no longer exists.',
  link_expired: 'This link has expired.',
  link_revoked: "This link was turned off by the map's owner.",
  forbidden: 'You can view this map but not edit it.',
  branch_locked: 'That branch is locked.',
  stale_base: 'Your copy of this map is too old.',
  op_id_reused: 'That group mixes seen and unseen operation ids.',
  username_taken: 'That username is taken.',
  invalid_transition: 'That change is not allowed from the current state.',
  session_ended: 'This presentation has ended.',
  already_presenting: 'This map is already being presented.',
  not_ready: 'That export is not ready yet.',
  clipboard_empty: 'Nothing to paste.',
  quota_exceeded: "This map's images would pass its limit.",
  invalid: 'That request is not valid.',
  wrong_type: 'Only PNG and JPEG images can be attached.',
  invalid_outline: "This file can't be imported:",
  root_protected: "The central topic can't be deleted.",
  storage_unavailable: 'File storage is unavailable. Try again in a moment.',
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: Record<string, string>;
  readonly lines?: string[];
  readonly retryAfterSeconds?: number;

  constructor(
    code: ErrorCode,
    message?: string,
    extra?: { fields?: Record<string, string>; lines?: string[]; retryAfterSeconds?: number },
  ) {
    super(message ?? ERROR_MESSAGES[code]);
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.fields = extra?.fields;
    this.lines = extra?.lines;
    this.retryAfterSeconds = extra?.retryAfterSeconds;
  }

  body(): ErrorBody {
    const body: ErrorBody = { error: this.code, message: this.message };
    if (this.fields) body.fields = this.fields;
    if (this.lines) body.lines = this.lines;
    return body;
  }
}

/** Picks the error the API must answer when several apply at once. */
export function firstError(candidates: ApiError[]): ApiError | null {
  let best: ApiError | null = null;
  for (const candidate of candidates) {
    if (best === null || errorRank(candidate.code) < errorRank(best.code)) best = candidate;
  }
  return best;
}
