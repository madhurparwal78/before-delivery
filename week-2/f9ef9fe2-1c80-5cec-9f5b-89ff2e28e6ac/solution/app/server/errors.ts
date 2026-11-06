// The single API error shape: {"error": code, "message": sentence} plus the extra fields a brief
// row names. Every refusal in the server is an ApiError; http.ts turns it into the response.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: { [key: string]: unknown } = {},
  ) {
    super(message);
  }

  body(): { [key: string]: unknown } {
    return { error: this.code, message: this.message, ...this.extra };
  }
}

export const refuse = {
  crossOrigin: () => new ApiError(403, "cross_origin", "Requests from another origin are not accepted."),
  payloadTooLarge: () => new ApiError(413, "payload_too_large", "The request body is too large."),
  unsupportedMediaType: () =>
    new ApiError(415, "unsupported_media_type", "The request body has an unsupported content type."),
  invalidJson: () => new ApiError(400, "invalid_json", "The request body is not valid JSON."),
  unauthenticated: () => new ApiError(401, "unauthenticated", "Sign in to continue."),
  invalidCredentials: () => new ApiError(401, "invalid_credentials", "Email or password is incorrect."),
  notFound: () => new ApiError(404, "not_found", "Not found."),
  forbidden: () => new ApiError(403, "forbidden", "Your role may not do this."),
  validation: (errors: { [field: string]: string }) =>
    new ApiError(422, "validation", "Some fields need attention.", { errors }),
  idempotencyKeyReused: () =>
    new ApiError(409, "idempotency_key_reused", "This idempotency key was already used for a different request."),
  holdNotActive: (state: string) =>
    new ApiError(409, "hold_not_active", `This hold is ${state} and no longer active.`, { state }),
  holdExpired: () => new ApiError(410, "hold_expired", "This hold has expired."),
  invalidTransition: (from: string, to: string) =>
    new ApiError(409, "invalid_transition", `Cannot move from ${from} to ${to}.`, { from, to }),
  bookingDayNotReached: () =>
    new ApiError(409, "booking_day_not_reached", "This can only happen from the booking day."),
  complianceBlocked: (date: string) =>
    new ApiError(422, "compliance_blocked", `The member's papers do not cover ${date}.`),
  sameDayClosed: (cutoff: string) =>
    new ApiError(422, "same_day_closed", `Same-day booking closed at ${cutoff} kitchen time.`),
  cellInPast: () => new ApiError(422, "cell_in_past", "Some of those cells have already started."),
  cellsTaken: (taken: unknown[]) => new ApiError(409, "cells_taken", "Those cells were just taken.", { taken }),
  seriesConflict: (dates: string[], taken: unknown[]) =>
    new ApiError(409, "series_conflict", "Some weeks are already taken.", { dates, taken }),
  quoteChanged: (quote: unknown) =>
    new ApiError(409, "quote_changed", "The price changed since it was quoted.", { quote }),
  rateCardExists: (date: string) =>
    new ApiError(409, "rate_card_exists", `A rate card already starts on ${date}.`),
  fileTooLarge: () => new ApiError(413, "file_too_large", "Files can be at most 5,000,000 bytes."),
  unsupportedType: () => new ApiError(415, "unsupported_type", "Upload a PDF, PNG or JPEG file."),
  billingUnavailable: () => new ApiError(503, "billing_unavailable", "Billing is unreachable."),
  filesUnavailable: () => new ApiError(503, "files_unavailable", "File storage is unreachable."),
  mailUnavailable: () => new ApiError(503, "mail_unavailable", "Email is unreachable."),
};
