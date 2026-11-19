import type { Response } from "express";

/** One error shape for every API error, per the published error body. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string> | null;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields ?? null;
  }
}

export const errors = {
  bodyTooLarge: () => new ApiError(413, "body_too_large", "That request was too large."),
  unsupportedMedia: () => new ApiError(415, "unsupported_media_type", "Send JSON for this request."),
  malformedJson: () => new ApiError(400, "malformed_json", "That request body isn't valid JSON."),
  idempotencyKeyRequired: () => new ApiError(400, "idempotency_key_required", "Send an Idempotency-Key header with this request."),
  crossOrigin: () => new ApiError(403, "cross_origin", "Requests from other origins aren't allowed."),
  unauthenticated: () => new ApiError(401, "unauthenticated", "Sign in to continue."),
  invalidCredentials: () => new ApiError(401, "invalid_credentials", "That email and password don't match."),
  notFound: () => new ApiError(404, "not_found", "We couldn't find that."),
  holdExpired: () => new ApiError(410, "hold_expired", "Your hold on that table has ended."),
  linkExpired: () => new ApiError(410, "link_expired", "This booking link no longer works."),
  offerExpired: () => new ApiError(410, "offer_expired", "This offer has ended."),
  offerClaimed: () => new ApiError(410, "offer_claimed", "This offer link no longer works."),
  validation: (fields: Record<string, string>) =>
    new ApiError(422, "validation_failed", "Some details need fixing.", fields),
  holdClosed: () => new ApiError(409, "hold_closed", "That hold has already been used."),
  tableTaken: () => new ApiError(409, "table_taken", "That table was just taken."),
  tableNotForParty: () => new ApiError(409, "table_not_for_party", "That table isn't set for your party."),
  slotNotBookable: () => new ApiError(409, "slot_not_bookable", "That time can't be booked online any more."),
  slotStarted: () => new ApiError(409, "slot_started", "That booking's time has started."),
  notTonight: () => new ApiError(409, "not_tonight", "That booking isn't for tonight."),
  invalidTransition: () => new ApiError(409, "invalid_transition", "That table has already changed."),
  tooEarly: (fromTime: string) => new ApiError(409, "too_early", `You can mark a no-show from ${fromTime}.`),
  idempotencyConflict: () => new ApiError(409, "idempotency_conflict", "That Idempotency-Key was used for a different request."),
  paymentFailed: () => new ApiError(402, "payment_failed", "Your deposit didn't go through, so nothing was booked."),
  holdsPaused: () => new ApiError(503, "holds_paused", "Table holds are paused right now."),
  depositsPaused: () => new ApiError(503, "deposits_paused", "Deposits are paused right now."),
};

/** Render the one published error body. */
function errorBody(err: ApiError): Record<string, unknown> {
  const inner: Record<string, unknown> = { code: err.code, message: err.message };
  if (err.status === 422 && err.fields) {
    inner.fields = err.fields;
  }
  return { error: inner };
}

export function sendError(res: Response, err: ApiError): void {
  res.status(err.status).json(errorBody(err));
}
