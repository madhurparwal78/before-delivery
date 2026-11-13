const ERRORS = {
  CROSS_ORIGIN: [403, "Requests must come from this site."],
  PAYLOAD_TOO_LARGE: [413, "That request is too large."],
  UNSUPPORTED_MEDIA_TYPE: [415, "Send JSON."],
  UNAUTHENTICATED: [401, "Sign in to continue."],
  NOT_VERIFIED: [403, "Confirm your email to join duels."],
  STORAGE_UNAVAILABLE: [503, "The atelier's records are out of reach. Try again in a minute."],
  LIVE_UNAVAILABLE: [503, "Live duels are unavailable right now. Solo games and the daily challenge still work."],
  MAIL_UNAVAILABLE: [503, "We couldn't send email right now. Try again in a minute."],
  RATE_LIMITED: [429, "Too many tries. Wait a minute and try again."],
  NOT_FOUND: [404, "This page isn't in the collection."],
  UNKNOWN_GAME: [404, "This game isn't in the collection."],
  ROOM_NOT_FOUND: [404, "No room has that code."],
  ROOM_FULL: [409, "This room already has two players."],
  CLOSED_GAME: [409, "This game is closed."],
  ALREADY_FINISHED: [409, "This game is already finished."],
  DAILY_NOT_FOUND: [404, "There is no daily challenge for that date."],
  DAILY_NOT_OPEN: [409, "That daily challenge is not open yet."],
  TOKEN_NOT_FOUND: [404, "This link isn't valid."],
  TOKEN_USED: [409, "This link was already used."],
  TOKEN_EXPIRED: [410, "This link has expired."],
  ALREADY_VERIFIED: [409, "Your email is already confirmed."],
  BAD_CREDENTIALS: [401, "Email or password is incorrect."],
  VALIDATION: [422, "Check these details."],
  LOG_MALFORMED: [400, "The move log is malformed."],
  LOG_SEQUENCE: [422, "A move is out of sequence."],
  LOG_TIME: [422, "A move has an impossible time."],
  GIVEN_CELL: [422, "A move changes a given."],
  LOCKED_CELL: [422, "A move changes a locked cell."],
  HINT_MISMATCH: [422, "A hint is not the one the rule picks."],
  HINT_LIMIT: [422, "A hint goes past the limit."],
  MISTAKE_LIMIT: [422, "A move was made after the mistake limit."],
  BOARD_UNSOLVED: [422, "The board is not solved."],
  SEED_INVALID: [422, "The seeded game is not valid."],
  INTERNAL: [500, "Something went wrong at the atelier. Try again."],
} as const;

type ErrorCode = keyof typeof ERRORS;

interface ErrorExtra {
  fields?: Record<string, string>;
  move?: number | null;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    readonly extra: ErrorExtra = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(ERRORS[code][1]);
    this.status = ERRORS[code][0];
  }

  body(): { error: { code: ErrorCode; message: string } & ErrorExtra } {
    return { error: { code: this.code, message: this.message, ...this.extra } };
  }
}
