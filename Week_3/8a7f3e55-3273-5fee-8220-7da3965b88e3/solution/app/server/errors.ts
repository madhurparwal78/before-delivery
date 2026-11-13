import type { ApiErrorBody, BookingStatus, ErrorCode, Quote } from "../shared/api.js";

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly extra: Omit<ApiErrorBody, "error" | "message"> = {},
  ) {
    super(message);
  }

  body(): ApiErrorBody {
    return { error: this.code, message: this.message, ...this.extra };
  }
}

export const apiErrors = {
  unauthenticated: () => new ApiError(401, "unauthenticated", "Sign in to continue."),
  invalidCredentials: () => new ApiError(401, "invalid_credentials", "The email or password is not recognised."),
  forbidden: () => new ApiError(403, "forbidden", "Your role is not allowed to do that."),
  crossOrigin: () => new ApiError(403, "cross_origin", "Cross-origin writes are not accepted."),
  accessEnded: () => new ApiError(403, "access_ended", "Access to these materials has ended."),
  notFound: () => new ApiError(404, "not_found", "That record does not exist or is not available to you."),
  invalidTransition: (status: BookingStatus) =>
    new ApiError(409, "invalid_transition", `The booking is ${status} and cannot take that action.`, { status }),
  seatFilled: () => new ApiError(409, "seat_filled", "That seat already has a holder."),
  alreadyHolding: () => new ApiError(409, "already_holding", "That interpreter already holds a seat on this booking."),
  scheduleConflict: () => new ApiError(409, "schedule_conflict", "That interpreter has another assignment at this time."),
  notQualified: () => new ApiError(409, "not_qualified", "That interpreter's credentials do not cover this setting."),
  openCallClosed: () => new ApiError(409, "open_call_closed", "The open call for this booking has closed."),
  alreadyTeam: () => new ApiError(409, "already_team", "This booking already has two seats."),
  quoteChanged: (quote: Quote) =>
    new ApiError(409, "quote_changed", "The cancellation charge changed since it was quoted.", { quote }),
  pendingSync: (refs: string[]) =>
    new ApiError(409, "pending_sync", "Some invoice lines have not synced with billing yet.", { pending_line_refs: refs }),
  weekClosed: () => new ApiError(409, "week_closed", "This billing week is already closed."),
  totalMismatch: (relayline: number, billing: number) =>
    new ApiError(409, "total_mismatch", "The Relayline total differs from the billing total.", {
      relayline_total_cents: relayline,
      billing_total_cents: billing,
    }),
  rateWouldReprice: (earliestAllowed: string) =>
    new ApiError(409, "rate_would_reprice", "That date would reprice billed work.", { earliest_allowed: earliestAllowed }),
  linkExpired: () => new ApiError(410, "link_expired", "That download link has expired."),
  payloadTooLarge: () => new ApiError(413, "payload_too_large", "The request is larger than allowed."),
  unsupportedType: () => new ApiError(415, "unsupported_type", "That kind of file is not accepted."),
  validation: (fields: Record<string, string>) =>
    new ApiError(422, "validation", "Some fields need attention.", { fields }),
  idempotencyInProgress: () => new ApiError(409, "idempotency_in_progress", "A request with that Idempotency-Key is still being processed."),
  idempotencyKeyReused: () =>
    new ApiError(422, "idempotency_key_reused", "That Idempotency-Key was already used for a different request."),
  billingUnavailable: () => new ApiError(503, "billing_unavailable", "Billing is unreachable right now."),
  internal: () => new ApiError(500, "internal_error", "Something went wrong on the server."),
  storageUnavailable: () => new ApiError(503, "storage_unavailable", "File storage is unreachable right now."),
};
