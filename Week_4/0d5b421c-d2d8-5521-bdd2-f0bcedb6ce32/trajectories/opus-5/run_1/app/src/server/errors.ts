import type { ApiErrorBody } from '../shared/types';

export type ErrorFields = Record<string, string>;

/** The one error shape every API failure is built through. */
export class ApiError extends Error {
  readonly status: number;

  readonly code: string;

  readonly fields?: ErrorFields;

  constructor(status: number, code: string, message: string, fields?: ErrorFields) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (fields) this.fields = fields;
  }

  body(): ApiErrorBody {
    const error: ApiErrorBody['error'] = {
      code: this.code,
      message: this.message,
    };
    if (this.fields) error.fields = this.fields;
    return { error };
  }
}

export const errors = {
  bodyTooLarge: (): ApiError =>
    new ApiError(413, 'body_too_large', 'That request body is larger than 16384 bytes.'),
  unsupportedMediaType: (): ApiError =>
    new ApiError(415, 'unsupported_media_type', 'Send this request as application/json.'),
  malformedJson: (): ApiError =>
    new ApiError(400, 'malformed_json', 'That request body is not valid JSON.'),
  idempotencyKeyRequired: (): ApiError =>
    new ApiError(400, 'idempotency_key_required', 'This request needs an Idempotency-Key header.'),
  crossOrigin: (): ApiError =>
    new ApiError(403, 'cross_origin', 'This request must come from the app itself.'),
  unauthenticated: (): ApiError => new ApiError(401, 'unauthenticated', 'Sign in to continue.'),
  invalidCredentials: (): ApiError =>
    new ApiError(401, 'invalid_credentials', "That email and password don't match."),
  idempotencyConflict: (): ApiError =>
    new ApiError(409, 'idempotency_conflict', 'That Idempotency-Key was used for another request.'),
  notFound: (): ApiError => new ApiError(404, 'not_found', 'We could not find that.'),
  validationFailed: (fields: ErrorFields): ApiError =>
    new ApiError(422, 'validation_failed', 'Some details need fixing.', fields),
  holdExpired: (): ApiError => new ApiError(410, 'hold_expired', 'That hold has ended.'),
  holdClosed: (): ApiError => new ApiError(409, 'hold_closed', 'That hold has already been used.'),
  linkExpired: (): ApiError =>
    new ApiError(410, 'link_expired', 'This booking link no longer works.'),
  offerExpired: (): ApiError => new ApiError(410, 'offer_expired', 'This offer has ended.'),
  offerClaimed: (): ApiError =>
    new ApiError(410, 'offer_claimed', 'This offer has already been claimed.'),
  tableTaken: (): ApiError => new ApiError(409, 'table_taken', 'That table was just taken.'),
  tableNotForParty: (): ApiError =>
    new ApiError(409, 'table_not_for_party', "That table isn't set for your party."),
  slotNotBookable: (): ApiError =>
    new ApiError(409, 'slot_not_bookable', "That time can't be booked online any more."),
  slotStarted: (): ApiError => new ApiError(409, 'slot_started', 'That table has already started.'),
  invalidTransition: (): ApiError =>
    new ApiError(409, 'invalid_transition', 'That table has already changed.'),
  notTonight: (): ApiError => new ApiError(409, 'not_tonight', 'That booking is not for tonight.'),
  tooEarly: (): ApiError =>
    new ApiError(409, 'too_early', 'It is too early to mark that booking as a no-show.'),
  paymentFailed: (): ApiError =>
    new ApiError(402, 'payment_failed', "Your deposit didn't go through, so nothing was booked."),
  depositsPaused: (): ApiError =>
    new ApiError(
      503,
      'deposits_paused',
      "We couldn't reach our payments system, so your booking is unchanged.",
    ),
  holdsPaused: (): ApiError =>
    new ApiError(503, 'holds_paused', 'Table holds are paused. Please try again in a few minutes.'),
};
