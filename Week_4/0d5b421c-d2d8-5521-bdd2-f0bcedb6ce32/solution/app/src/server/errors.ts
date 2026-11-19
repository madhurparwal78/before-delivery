// Every API error is built here, in the one published shape: {"error":{"code","message"[,"fields"]}}.
import type { ErrorBody } from "../shared/api.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export function errorBody(error: ApiError): ErrorBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.fields === undefined ? {} : { fields: error.fields }),
    },
  };
}

export const apiErrors = {
  bodyTooLarge: () => new ApiError(413, "body_too_large", "The request body is larger than 16,384 bytes."),
  unsupportedMediaType: () => new ApiError(415, "unsupported_media_type", "Send the request as application/json."),
  malformedJson: () => new ApiError(400, "malformed_json", "The request body is not valid JSON."),
  idempotencyKeyRequired: () =>
    new ApiError(400, "idempotency_key_required", "Send an Idempotency-Key of 1 to 64 visible ASCII characters."),
  crossOrigin: () => new ApiError(403, "cross_origin", "Requests must come from this site."),
  unauthenticated: () => new ApiError(401, "unauthenticated", "Sign in as the host to continue."),
  invalidCredentials: () => new ApiError(401, "invalid_credentials", "That email and password don't match."),
  idempotencyConflict: () =>
    new ApiError(409, "idempotency_conflict", "That Idempotency-Key was already used for a different request."),
  notFound: () => new ApiError(404, "not_found", "Nothing was found at that address."),
  holdExpired: () => new ApiError(410, "hold_expired", "That hold has ended."),
  linkExpired: () => new ApiError(410, "link_expired", "This booking link no longer works."),
  offerExpired: () => new ApiError(410, "offer_expired", "This offer has ended."),
  offerClaimed: () => new ApiError(410, "offer_claimed", "This offer was already claimed."),
  validationFailed: (fields: Record<string, string>) =>
    new ApiError(422, "validation_failed", "Some details need fixing.", fields),
  tableNotForParty: () => new ApiError(409, "table_not_for_party", "That table isn't set for this party."),
  tableTaken: () => new ApiError(409, "table_taken", "That table is no longer free."),
  slotNotBookable: () => new ApiError(409, "slot_not_bookable", "That time can't be booked online."),
  holdClosed: () => new ApiError(409, "hold_closed", "That hold is already closed."),
  invalidTransition: () => new ApiError(409, "invalid_transition", "That booking can't change that way."),
  slotStarted: () => new ApiError(409, "slot_started", "That booking has already started."),
  notTonight: () => new ApiError(409, "not_tonight", "Only tonight's bookings can be seated."),
  tooEarly: (earliest: string) => new ApiError(409, "too_early", `You can mark a no-show from ${earliest}.`),
  paymentFailed: () => new ApiError(402, "payment_failed", "The deposit payment did not go through."),
  holdsPaused: () => new ApiError(503, "holds_paused", "Table holds are paused."),
  depositsPaused: () => new ApiError(503, "deposits_paused", "Deposits are paused."),
};
