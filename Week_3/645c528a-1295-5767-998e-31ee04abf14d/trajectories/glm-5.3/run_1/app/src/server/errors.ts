export type ErrCode =
  | 'cross_origin'
  | 'malformed_json'
  | 'unsupported_media_type'
  | 'payload_too_large'
  | 'unauthenticated'
  | 'not_found'
  | 'validation_failed'
  | 'store_unavailable'
  | 'payments_unavailable'
  | 'mail_unavailable'
  | 'under_age'
  | 'email_taken'
  | 'invalid_credentials'
  | 'rate_limited'
  | 'link_invalid'
  | 'already_verified'
  | 'invite_expired'
  | 'table_full'
  | 'in_match'
  | 'insufficient_coins'
  | 'insufficient_funds'
  | 'level_locked'
  | 'mode_locked'
  | 'already_queued'
  | 'already_paired'
  | 'not_queued'
  | 'not_seated'
  | 'other_device'
  | 'not_your_turn'
  | 'shot_clock_expired'
  | 'called_pocket_required'
  | 'match_over'
  | 'script_exhausted'
  | 'no_ball_in_hand'
  | 'cue_ball_overlap'
  | 'match_not_over'
  | 'already_owned'
  | 'not_owned'
  | 'age_restricted'
  | 'email_unverified'
  | 'idempotency_conflict'
  | 'unknown_code'
  | 'blocked'
  | 'already_friends'
  | 'request_pending'
  | 'forbidden'
  | 'already_in_club'
  | 'name_taken'
  | 'club_full'
  | 'owner_must_transfer'
  | 'not_a_member'
  | 'tournament_full'
  | 'already_registered'
  | 'tournament_closed'
  | 'not_entered'
  | 'not_in_ready_check'
  | 'daily_claimed'
  | 'refill_not_needed'
  | 'refill_limit';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrCode;
  readonly fields?: Record<string, string>;
  readonly headers?: Record<string, string>;

  constructor(status: number, code: ErrCode, message: string, fields?: Record<string, string>, headers?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.headers = headers;
  }

  body(): { error: string; message: string; errors?: Record<string, string> } {
    const out: { error: string; message: string; errors?: Record<string, string> } = { error: this.code, message: this.message };
    if (this.fields) out.errors = this.fields;
    return out;
  }
}

export const errors = {
  crossOrigin: () => new ApiError(403, 'cross_origin', 'Requests must stay on this origin.'),
  malformedJson: () => new ApiError(400, 'malformed_json', 'The request body is not valid JSON.'),
  unsupportedMediaType: () => new ApiError(415, 'unsupported_media_type', 'Send application/json.'),
  payloadTooLarge: () => new ApiError(413, 'payload_too_large', 'The request body is too large.'),
  unauthenticated: () => new ApiError(401, 'unauthenticated', 'Sign in to continue.'),
  notFound: () => new ApiError(404, 'not_found', 'Not found.'),
  validation: (fields: Record<string, string>) => new ApiError(422, 'validation_failed', 'Check these fields', fields),
  storeUnavailable: () => new ApiError(503, 'store_unavailable', 'Could not reach the table'),
  paymentsUnavailable: () => new ApiError(503, 'payments_unavailable', 'Payments are down. You have not been charged.'),
  mailUnavailable: () => new ApiError(503, 'mail_unavailable', 'Could not send mail. Try again soon.'),
  forbidden: (message: string) => new ApiError(403, 'forbidden', message),
};
