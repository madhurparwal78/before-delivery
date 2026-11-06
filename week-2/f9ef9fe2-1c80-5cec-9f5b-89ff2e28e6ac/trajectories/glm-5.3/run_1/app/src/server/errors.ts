import type { Response } from "express";

/**
 * The single error shape. Every API error flows through ApiError, and no
 * handler builds its own body.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function crossOrigin(): ApiError {
  return new ApiError(403, "cross_origin", "Cross-origin requests are not supported.");
}

export function payloadTooLarge(): ApiError {
  return new ApiError(413, "payload_too_large", "The request body is too large.");
}

export function fileTooLarge(): ApiError {
  return new ApiError(413, "file_too_large", "Files can be at most 5,000,000 bytes.");
}

export function unsupportedMediaType(): ApiError {
  return new ApiError(415, "unsupported_media_type", "The request content type is not supported.");
}

export function invalidJson(): ApiError {
  return new ApiError(400, "invalid_json", "The request body is not valid JSON.");
}

export function unauthenticated(): ApiError {
  return new ApiError(401, "unauthenticated", "You need to sign in.");
}

export function notFound(): ApiError {
  return new ApiError(404, "not_found", "Nothing here.");
}

export function forbidden(): ApiError {
  return new ApiError(403, "forbidden", "You may not do that.");
}

export function invalidCredentials(): ApiError {
  return new ApiError(401, "invalid_credentials", "Email or password is incorrect.");
}

export type FieldErrors = Record<string, string>;

export function validation(errors: FieldErrors): ApiError {
  const first = Object.entries(errors)[0];
  return new ApiError(422, "validation", first ? first[1] : "The request is not valid.", { errors });
}

export function complianceBlocked(): ApiError {
  return new ApiError(422, "compliance_blocked", "Papers do not cover this date.");
}

export function sameDayClosed(): ApiError {
  return new ApiError(422, "same_day_closed", "Same-day booking is closed.");
}

export function cellInPast(): ApiError {
  return new ApiError(422, "cell_in_past", "Some cells have already started.");
}

export function holdNotActive(state: string): ApiError {
  return new ApiError(409, "hold_not_active", "This hold is no longer active.", { state });
}

export function holdExpired(): ApiError {
  return new ApiError(410, "hold_expired", "This hold has expired.");
}

export function invalidTransition(from: string, to: string): ApiError {
  return new ApiError(409, "invalid_transition", `${from} cannot move to ${to}.`, { from, to });
}

export function bookingDayNotReached(): ApiError {
  return new ApiError(409, "booking_day_not_reached", "The booking day has not been reached.");
}

export function cellsTaken(taken: unknown[]): ApiError {
  return new ApiError(409, "cells_taken", "Those cells were just taken.", { taken });
}

export function seriesConflict(dates: string[], taken: unknown[]): ApiError {
  return new ApiError(409, "series_conflict", "These weeks are already taken.", { dates, taken });
}

export function quoteChanged(quote: unknown): ApiError {
  return new ApiError(409, "quote_changed", "The price has changed.", { quote });
}

export function rateCardExists(): ApiError {
  return new ApiError(409, "rate_card_exists", "A rate card already starts on that date.");
}

export function idempotencyKeyReused(): ApiError {
  return new ApiError(409, "idempotency_key_reused", "This idempotency key was used for another request.");
}

export function billingUnavailable(): ApiError {
  return new ApiError(503, "billing_unavailable", "Billing is unreachable right now.");
}

export function filesUnavailable(): ApiError {
  return new ApiError(503, "files_unavailable", "File storage is unreachable right now.");
}

export function mailUnavailable(): ApiError {
  return new ApiError(503, "mail_unavailable", "Email is unreachable right now.");
}

export function sendError(res: Response, error: ApiError): void {
  const body: Record<string, unknown> = { error: error.code, message: error.message };
  for (const [key, value] of Object.entries(error.extra)) {
    body[key] = value;
  }
  res.status(error.status).json(body);
}
