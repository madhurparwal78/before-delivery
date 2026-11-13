import { copy } from '../shared/copy';
import { config } from './config';

export type ErrorCode =
  | 'too_large'
  | 'no_player'
  | 'rate_limited'
  | 'not_found'
  | 'link_off'
  | 'link_replaced'
  | 'not_host'
  | 'watching'
  | 'game_full'
  | 'game_solved'
  | 'square_locked'
  | 'link_already_off'
  | 'op_id_reused'
  | 'race_started'
  | 'race_not_started'
  | 'invalid'
  | 'invalid_puzzle'
  | 'storage_unavailable';

const STATUS: Record<ErrorCode, number> = {
  too_large: 413,
  no_player: 401,
  rate_limited: 429,
  not_found: 404,
  link_off: 410,
  link_replaced: 410,
  not_host: 403,
  watching: 403,
  game_full: 409,
  game_solved: 409,
  square_locked: 409,
  link_already_off: 409,
  op_id_reused: 409,
  race_started: 409,
  race_not_started: 409,
  invalid: 422,
  invalid_puzzle: 422,
  storage_unavailable: 503,
};

const MESSAGE: Record<ErrorCode, string> = {
  too_large: 'That request body is too large.',
  no_player: 'Choose a display name first.',
  rate_limited: copy.rateLimited,
  not_found: copy.unknownGame,
  link_off: copy.deadLinkOff,
  link_replaced: copy.deadLinkReplaced,
  not_host: 'Only the host can do that.',
  watching: 'You are watching this race.',
  game_full: copy.gameFull,
  game_solved: copy.alreadySolved,
  square_locked: copy.squareLocked,
  link_already_off: 'This game link is already off.',
  op_id_reused: 'That operation id was already used for another write.',
  race_started: 'The race has already started.',
  race_not_started: copy.raceNotStarted,
  invalid: 'That request is not valid.',
  invalid_puzzle: 'That puzzle file is not valid.',
  storage_unavailable: copy.storageOutage,
};

export interface ErrorBody {
  error: ErrorCode;
  message: string;
  fields?: Record<string, string>;
  lines?: string[];
}

export class ApiError extends Error {
  readonly code: ErrorCode;

  readonly status: number;

  readonly fields?: Record<string, string>;

  readonly lines?: string[];

  constructor(
    code: ErrorCode,
    options: { message?: string; fields?: Record<string, string>; lines?: string[] } = {},
  ) {
    super(options.message ?? MESSAGE[code]);
    this.code = code;
    this.status = STATUS[code];
    if (options.fields) this.fields = options.fields;
    if (options.lines) this.lines = options.lines;
  }

  body(): ErrorBody {
    const body: ErrorBody = { error: this.code, message: this.message };
    if (this.fields) body.fields = this.fields;
    if (this.lines) body.lines = this.lines;
    return body;
  }
}

export const errors = {
  tooLargeJson: (): ApiError => new ApiError('too_large'),
  tooLargeUpload: (): ApiError =>
    new ApiError('too_large', { message: copy.uploadTooLarge(config.uploadMaxBytes) }),
  noPlayer: (): ApiError => new ApiError('no_player'),
  rateLimited: (): ApiError => new ApiError('rate_limited'),
  notFound: (message?: string): ApiError =>
    message === undefined ? new ApiError('not_found') : new ApiError('not_found', { message }),
  invalid: (fields?: Record<string, string>): ApiError =>
    fields === undefined ? new ApiError('invalid') : new ApiError('invalid', { fields }),
  invalidPuzzle: (count: number, lines: string[]): ApiError =>
    new ApiError('invalid_puzzle', { message: copy.uploadProblems(count), lines }),
  storageUnavailable: (): ApiError => new ApiError('storage_unavailable'),
};
