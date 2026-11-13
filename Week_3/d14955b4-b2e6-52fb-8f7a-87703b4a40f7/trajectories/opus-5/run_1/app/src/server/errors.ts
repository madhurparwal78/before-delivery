import type { ApiErrorBody } from '../shared/types';

export const ERROR_SENTENCES: Readonly<Record<string, string>> = {
  invalid_credentials: "That email and password don't match.",
  unauthenticated: 'Sign in to continue.',
  refresh_reused: 'That sign-in was replaced. Sign in again.',
  change_refused: "This change needs the session's change token.",
  forbidden: "You can't do that here.",
  not_found: "There's nothing here.",
  validation: 'Check the fields and send it again.',
  idempotency_mismatch: 'That key was used for a different request.',
  idempotency_in_progress: 'That request is still being handled.',
  thread_closed: 'This thread is closed. It reopens when the player writes again.',
  not_answered: 'Answer the player before closing.',
  already_closed: 'This thread is already closed.',
  rate_limited: "You're writing faster than the inbox can read.",
  too_large: 'That request is too large.',
  unsupported_media_type: 'Send this as JSON.',
  invalid_identity: "This help window couldn't confirm who you are. Reopen it from the game.",
  bad_signature: "That event's signature did not match.",
  stale_timestamp: "That event's timestamp is outside the 300 s window.",
  nonce_seen: "That event's nonce was already seen.",
  not_attached: 'That attachment is not stored yet.',
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string> | undefined;
  readonly headers: Record<string, string> | undefined;

  constructor(
    status: number,
    code: string,
    options: { fields?: Record<string, string>; headers?: Record<string, string> } = {},
  ) {
    super(code);
    this.status = status;
    this.code = code;
    this.fields = options.fields;
    this.headers = options.headers;
  }

  body(): ApiErrorBody {
    const error: ApiErrorBody['error'] = {
      code: this.code,
      message: ERROR_SENTENCES[this.code] ?? 'Something went wrong.',
    };
    if (this.fields) error.fields = this.fields;
    return { error };
  }
}

export const notFound = (): ApiError => new ApiError(404, 'not_found');
export const forbidden = (): ApiError => new ApiError(403, 'forbidden');
export const unauthenticated = (): ApiError => new ApiError(401, 'unauthenticated');
export const changeRefused = (): ApiError => new ApiError(403, 'change_refused');
export const validation = (fields: Record<string, string>): ApiError =>
  new ApiError(422, 'validation', { fields });
