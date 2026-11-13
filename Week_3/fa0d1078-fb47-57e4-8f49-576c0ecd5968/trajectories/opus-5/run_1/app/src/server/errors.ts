import type { ApiErrorBody } from '../shared/api';
import { M } from '../shared/messages';

export type ErrorCode =
  | 'CROSS_ORIGIN'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'UNAUTHENTICATED'
  | 'NOT_VERIFIED'
  | 'STORAGE_UNAVAILABLE'
  | 'LIVE_UNAVAILABLE'
  | 'MAIL_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'UNKNOWN_GAME'
  | 'ROOM_NOT_FOUND'
  | 'DAILY_NOT_FOUND'
  | 'TOKEN_NOT_FOUND'
  | 'ALREADY_VERIFIED'
  | 'TOKEN_USED'
  | 'TOKEN_EXPIRED'
  | 'CLOSED_GAME'
  | 'ALREADY_FINISHED'
  | 'DAILY_NOT_OPEN'
  | 'ROOM_FULL'
  | 'BAD_CREDENTIALS'
  | 'LOG_MALFORMED'
  | 'VALIDATION'
  | 'SEED_INVALID'
  | 'LOG_SEQUENCE'
  | 'LOG_TIME'
  | 'GIVEN_CELL'
  | 'LOCKED_CELL'
  | 'HINT_MISMATCH'
  | 'HINT_LIMIT'
  | 'MISTAKE_LIMIT'
  | 'BOARD_UNSOLVED'
  | 'INTERNAL';

const SENTENCES: Record<ErrorCode, string> = {
  CROSS_ORIGIN: 'This request came from another origin.',
  PAYLOAD_TOO_LARGE: 'That request body is too large.',
  UNSUPPORTED_MEDIA_TYPE: 'Send a JSON body.',
  UNAUTHENTICATED: 'Sign in to continue.',
  NOT_VERIFIED: M.notVerifiedDuel,
  STORAGE_UNAVAILABLE: M.storageUnavailable,
  LIVE_UNAVAILABLE: M.liveUnavailable,
  MAIL_UNAVAILABLE: M.mailUnavailable,
  RATE_LIMITED: M.rateLimited,
  NOT_FOUND: M.pageNotFound,
  UNKNOWN_GAME: M.gameNotFound,
  ROOM_NOT_FOUND: M.roomNotFound,
  DAILY_NOT_FOUND: 'That date has no daily challenge.',
  TOKEN_NOT_FOUND: "That link isn't valid.",
  ALREADY_VERIFIED: 'That email is already confirmed.',
  TOKEN_USED: 'That link was already used.',
  TOKEN_EXPIRED: 'That link has expired.',
  CLOSED_GAME: 'That game is closed.',
  ALREADY_FINISHED: 'That game is already finished.',
  DAILY_NOT_OPEN: 'That daily challenge is not open yet.',
  ROOM_FULL: M.roomFull,
  BAD_CREDENTIALS: M.badCredentials,
  LOG_MALFORMED: 'That move log is malformed.',
  VALIDATION: 'Check these details.',
  SEED_INVALID: 'That seed does not fit the puzzle.',
  LOG_SEQUENCE: 'The move log skips a move.',
  LOG_TIME: 'The move log goes back in time.',
  GIVEN_CELL: 'The move log changes a given cell.',
  LOCKED_CELL: 'The move log changes a locked cell.',
  HINT_MISMATCH: 'The move log has a hint the rule did not pick.',
  HINT_LIMIT: 'The move log uses more hints than allowed.',
  MISTAKE_LIMIT: 'The move log continues past the mistake limit.',
  BOARD_UNSOLVED: 'That board is not solved.',
  INTERNAL: M.unexpected,
};

const STATUSES: Record<ErrorCode, number> = {
  CROSS_ORIGIN: 403,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UNAUTHENTICATED: 401,
  NOT_VERIFIED: 403,
  STORAGE_UNAVAILABLE: 503,
  LIVE_UNAVAILABLE: 503,
  MAIL_UNAVAILABLE: 503,
  RATE_LIMITED: 429,
  NOT_FOUND: 404,
  UNKNOWN_GAME: 404,
  ROOM_NOT_FOUND: 404,
  DAILY_NOT_FOUND: 404,
  TOKEN_NOT_FOUND: 404,
  ALREADY_VERIFIED: 409,
  TOKEN_USED: 409,
  TOKEN_EXPIRED: 410,
  CLOSED_GAME: 409,
  ALREADY_FINISHED: 409,
  DAILY_NOT_OPEN: 409,
  ROOM_FULL: 409,
  BAD_CREDENTIALS: 401,
  LOG_MALFORMED: 400,
  VALIDATION: 422,
  SEED_INVALID: 422,
  LOG_SEQUENCE: 422,
  LOG_TIME: 422,
  GIVEN_CELL: 422,
  LOCKED_CELL: 422,
  HINT_MISMATCH: 422,
  HINT_LIMIT: 422,
  MISTAKE_LIMIT: 422,
  BOARD_UNSOLVED: 422,
  INTERNAL: 500,
};

interface ApiErrorOptions {
  fields?: Record<string, string>;
  move?: number | null;
  headers?: Record<string, string>;
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: Record<string, string>;
  readonly move?: number | null;
  readonly headers?: Record<string, string>;

  constructor(code: ErrorCode, options: ApiErrorOptions = {}) {
    super(SENTENCES[code]);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUSES[code];
    if (options.fields) this.fields = options.fields;
    if (options.move !== undefined) this.move = options.move;
    if (options.headers) this.headers = options.headers;
  }

  get body(): ApiErrorBody {
    const error: ApiErrorBody['error'] = { code: this.code, message: this.message };
    if (this.fields) error.fields = this.fields;
    if (this.move !== undefined) error.move = this.move;
    return { error };
  }
}
