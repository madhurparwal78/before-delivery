// The single error shape every endpoint answers with.

type ErrorCode =
  | "unauthenticated" | "email_unverified" | "not_found" | "payload_too_large" | "unsupported_media_type"
  | "bad_origin" | "validation_failed" | "invalid_transition" | "email_taken" | "handle_taken" | "link_expired"
  | "link_invalid" | "already_verified" | "mail_unavailable" | "invalid_credentials" | "user_not_found"
  | "already_friends" | "blocked" | "request_not_found" | "not_friends" | "not_blocked" | "not_leader"
  | "already_in_party" | "party_full" | "party_busy" | "invite_not_found" | "already_solo" | "lobby_not_found"
  | "match_not_found" | "round_not_found" | "round_not_resolved" | "tick_out_of_range" | "rate_limited"
  | "starting" | "internal";

const MESSAGES: Record<ErrorCode, string> = {
  unauthenticated: "Sign in first.",
  email_unverified: "Verify your email first.",
  not_found: "There is nothing at this address.",
  payload_too_large: "The request body is too large.",
  unsupported_media_type: "Send the request body as JSON.",
  bad_origin: "Requests must come from this site.",
  validation_failed: "Check the highlighted fields.",
  invalid_transition: "That can't be done right now.",
  email_taken: "That email already has an account.",
  handle_taken: "That handle is taken.",
  link_expired: "This link has expired. Request a new one.",
  link_invalid: "This link has already been used or replaced by a newer one.",
  already_verified: "Your email is already verified.",
  mail_unavailable: "Mail is down right now. Try again in a minute.",
  invalid_credentials: "Email or password is wrong.",
  user_not_found: "There is no player with that handle.",
  already_friends: "You're already friends with this player.",
  blocked: "You can't do that with this player.",
  request_not_found: "That request is no longer open.",
  not_friends: "You can only do that with friends.",
  not_blocked: "That player isn't blocked.",
  not_leader: "Only the party leader can do that.",
  already_in_party: "That player is already in your party.",
  party_full: "That party is full.",
  party_busy: "That party is busy right now. Try again after its search or match.",
  invite_not_found: "That invite is no longer open.",
  already_solo: "You're not in a party with anyone.",
  lobby_not_found: "There is no such lobby.",
  match_not_found: "There is no such match.",
  round_not_found: "There is no such round.",
  round_not_resolved: "That round hasn't finished yet.",
  tick_out_of_range: "That tick is outside the round.",
  rate_limited: "Slow down — you can send again in a few seconds.",
  starting: "The server is still starting.",
  internal: "Something went wrong. Try again.",
};

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401, email_unverified: 403, not_found: 404, payload_too_large: 413, unsupported_media_type: 415,
  bad_origin: 403, validation_failed: 422, invalid_transition: 409, email_taken: 409, handle_taken: 409,
  link_expired: 410, link_invalid: 410, already_verified: 409, mail_unavailable: 503, invalid_credentials: 401,
  user_not_found: 404, already_friends: 409, blocked: 403, request_not_found: 404, not_friends: 403,
  not_blocked: 404, not_leader: 403, already_in_party: 409, party_full: 409, party_busy: 409,
  invite_not_found: 404, already_solo: 409, lobby_not_found: 404, match_not_found: 404, round_not_found: 404,
  round_not_resolved: 409, tick_out_of_range: 422, rate_limited: 429, starting: 503, internal: 500,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly extra: Record<string, unknown>;
  readonly headers: Record<string, string>;

  constructor(code: ErrorCode, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}, status = STATUS[code]) {
    super(MESSAGES[code]);
    this.code = code;
    this.status = status;
    this.extra = extra;
    this.headers = headers;
  }

  body(): { error: Record<string, unknown> } {
    return { error: { code: this.code, message: this.message, ...this.extra } };
  }
}

export function fieldError(fields: Record<string, string>): ApiError {
  return new ApiError("validation_failed", { fields });
}

export function transitionError(state: string): ApiError {
  return new ApiError("invalid_transition", { state });
}

export const FIELD_COPY = {
  email: "Enter a valid email address.",
  handle: "Use 3 to 20 lowercase letters, digits or underscores.",
  password: "Use 10 to 128 characters.",
  body: "Messages are 1 to 500 characters.",
  ownHandle: "You can't add yourself.",
  ownUser: "You can't block yourself.",
  partyMember: "Choose a member of your party.",
} as const;
