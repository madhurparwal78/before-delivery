import type { ApiError } from '../shared/types.js';

/** The one error shape every endpoint and socket answer is built from. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string> | undefined;
  readonly state: string | undefined;
  readonly headers: Record<string, string> | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    options: {
      fields?: Record<string, string>;
      state?: string;
      headers?: Record<string, string>;
    } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.fields = options.fields;
    this.state = options.state;
    this.headers = options.headers;
  }

  body(): ApiError {
    const error: ApiError['error'] = { code: this.code, message: this.message };
    if (this.fields !== undefined) error.fields = this.fields;
    if (this.state !== undefined) error.state = this.state;
    return { error };
  }
}

export function validationFailed(fields: Record<string, string>): AppError {
  return new AppError(422, 'validation_failed', 'Check the highlighted fields.', { fields });
}

export function invalidTransition(state: string): AppError {
  return new AppError(409, 'invalid_transition', 'That state change is not allowed now.', {
    state,
  });
}

export const fail = {
  unauthenticated: (): AppError => new AppError(401, 'unauthenticated', 'Sign in to continue.'),
  emailUnverified: (): AppError =>
    new AppError(403, 'email_unverified', 'Verify your email first.'),
  notFound: (): AppError => new AppError(404, 'not_found', 'Unknown endpoint.'),
  payloadTooLarge: (): AppError =>
    new AppError(413, 'payload_too_large', 'That request body is too large.'),
  unsupportedMediaType: (): AppError =>
    new AppError(415, 'unsupported_media_type', 'Send application/json.'),
  badOrigin: (): AppError => new AppError(403, 'bad_origin', 'Cross-origin requests are refused.'),
  emailTaken: (): AppError => new AppError(409, 'email_taken', 'That email already has an account.'),
  handleTaken: (): AppError => new AppError(409, 'handle_taken', 'That handle is taken.'),
  linkExpired: (): AppError => new AppError(410, 'link_expired', 'This link has expired.'),
  linkInvalid: (): AppError =>
    new AppError(410, 'link_invalid', 'This link has already been used or replaced.'),
  alreadyVerified: (): AppError =>
    new AppError(409, 'already_verified', 'Your email is already verified.'),
  mailUnavailable: (): AppError =>
    new AppError(503, 'mail_unavailable', 'Mail is down right now.'),
  invalidCredentials: (): AppError =>
    new AppError(401, 'invalid_credentials', 'Email or password is wrong.'),
  userNotFound: (): AppError => new AppError(404, 'user_not_found', 'No player with that handle.'),
  alreadyFriends: (): AppError =>
    new AppError(409, 'already_friends', 'You are already friends.'),
  blocked: (): AppError => new AppError(403, 'blocked', 'A block stands between you.'),
  requestNotFound: (): AppError =>
    new AppError(404, 'request_not_found', 'That request is no longer open.'),
  notFriends: (): AppError => new AppError(404, 'not_friends', 'You are not friends.'),
  notFriendsForbidden: (): AppError =>
    new AppError(403, 'not_friends', 'You can only do that with friends.'),
  notBlocked: (): AppError => new AppError(404, 'not_blocked', 'That player is not blocked.'),
  notLeader: (): AppError => new AppError(403, 'not_leader', 'Only the party leader can do that.'),
  alreadyInParty: (): AppError =>
    new AppError(409, 'already_in_party', 'That player is already in your party.'),
  partyFull: (): AppError => new AppError(409, 'party_full', 'That party is full.'),
  partyBusy: (): AppError =>
    new AppError(409, 'party_busy', 'That party is busy right now.'),
  inviteNotFound: (): AppError =>
    new AppError(404, 'invite_not_found', 'That invite is no longer open.'),
  alreadySolo: (): AppError => new AppError(409, 'already_solo', 'You are already on your own.'),
  lobbyNotFound: (): AppError => new AppError(404, 'lobby_not_found', 'Unknown lobby.'),
  matchNotFound: (): AppError => new AppError(404, 'match_not_found', 'Unknown match.'),
  roundNotFound: (): AppError => new AppError(404, 'round_not_found', 'Unknown round.'),
  roundNotResolved: (): AppError =>
    new AppError(409, 'round_not_resolved', 'That round has not resolved yet.'),
  tickOutOfRange: (): AppError =>
    new AppError(422, 'tick_out_of_range', 'That tick is outside the round.', {
      fields: { tick: 'Choose a tick inside the round.' },
    }),
  rateLimited: (retryAfterSeconds: number): AppError =>
    new AppError(429, 'rate_limited', 'Slow down — you can send again in a few seconds.', {
      headers: { 'Retry-After': String(retryAfterSeconds) },
    }),
  internal: (): AppError => new AppError(500, 'internal_error', 'Something went wrong.'),
};
