import type { ServerResponse } from "node:http";
import { euros } from "../../shared/money";
import { config } from "../config";

interface ErrorExtras {
  fields?: Record<string, string>;
  ride?: unknown;
  retryAfterSeconds?: number;
  /** The transaction keeps its writes (a lazy expiry) and the error is still answered. */
  commit?: boolean;
}

/** The only error type the API raises; `respondError` turns it into the one error body shape. */
export class ApiError extends Error {
  readonly commit: boolean;

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extras: ErrorExtras = {},
  ) {
    super(message);
    this.commit = extras.commit === true;
  }
}

const NO_ACCESS = "You do not have access to this.";

export const apiErrors = {
  unauthenticated: () => new ApiError(401, "unauthenticated", "Sign in to continue."),
  notFound: () => new ApiError(404, "not_found", "We could not find that."),
  forbidden: (message: string = NO_ACCESS) => new ApiError(403, "forbidden", message),
  unverifiedDriver: () => new ApiError(403, "forbidden", "Your ID must be verified before you can offer a ride."),
  bookingRateLimited: (retryAfterSeconds: number) =>
    new ApiError(429, "rate_limited", `You have made ${config.requestRatePerHour} booking requests in the last hour. Try again in ${Math.ceil(retryAfterSeconds / 60)} minutes.`, { retryAfterSeconds }),
  messageRateLimited: (retryAfterSeconds: number) =>
    new ApiError(429, "rate_limited", `You are sending messages too fast. Try again in ${retryAfterSeconds} seconds.`, { retryAfterSeconds }),
  codeRateLimited: (retryAfterSeconds: number) =>
    new ApiError(429, "rate_limited", `Too many codes asked for. Try again in ${Math.ceil(retryAfterSeconds / 60)} minutes.`, { retryAfterSeconds }),
  seatTaken: () => new ApiError(409, "seat_taken", "This seat was just taken. Choose another span or ride."),
  rideChanged: (ride: unknown) => new ApiError(409, "ride_changed", "The driver changed this ride. Check the new times before booking.", { ride }),
  editConflict: () => new ApiError(409, "edit_conflict", "This ride was changed in another window. Reload to see the latest version."),
  requestExpired: (commit = false) => new ApiError(409, "request_expired", "This request expired before you answered it.", { commit }),
  alreadyDecided: () => new ApiError(409, "already_decided", "This was already decided."),
  bookingClosed: (minutes: number) => new ApiError(409, "booking_closed", `Booking for this ride closed ${minutes} minutes before departure.`),
  holdExpired: () => new ApiError(409, "hold_expired", "Your seat hold ran out. Choose your span again.", { commit: true }),
  alreadyRated: () => new ApiError(409, "already_rated", "You have already rated this trip."),
  ratingNotOpen: () => new ApiError(409, "rating_not_open", "You can rate this trip once it arrives."),
  ratingClosed: () => new ApiError(409, "rating_closed", "The rating window for this trip has closed."),
  invalidTransition: () => new ApiError(409, "invalid_transition", "This booking can no longer change that way."),
  idempotencyConflict: () => new ApiError(409, "idempotency_conflict", "This request was already sent with different details."),
  payloadTooLarge: () => new ApiError(413, "payload_too_large", "The request is too large."),
  unsupportedMediaType: () => new ApiError(415, "unsupported_media_type", "Send this request as JSON."),
  validation: (fields: Record<string, string>) => new ApiError(422, "validation_failed", "Check the highlighted fields.", { fields }),
  priceOutOfRange: (lowCents: number, highCents: number, km: number) =>
    new ApiError(422, "price_out_of_range", `Set a price between ${euros(lowCents)} and ${euros(highCents)} for ${km} km.`),
  tooManyStopovers: () => new ApiError(422, "too_many_stopovers", `A ride can have at most ${config.maxStopovers} stopovers.`),
  insufficientFunds: (balanceCents: number) =>
    new ApiError(422, "insufficient_funds", `Your wallet has ${euros(balanceCents)}. Add money to book this seat.`),
  fileType: (kind: "photo" | "id_document") =>
    new ApiError(422, "file_type", kind === "photo" ? "Upload a PNG or JPEG file." : "Upload a PNG, JPEG or PDF file."),
  fileTooLarge: (limitBytes: number) =>
    new ApiError(422, "file_too_large", `The file must be ${Math.floor(limitBytes / 1_048_576)} MB or smaller.`),
  codeInvalid: () => new ApiError(422, "code_invalid", "That code is not right. Check the email and try again."),
  codeExpired: () => new ApiError(422, "code_expired", "This code has expired. Ask for a new one."),
  storageUnavailable: () =>
    new ApiError(503, "storage_unavailable", "We could not store your file right now. Nothing was lost; try again in a moment."),
  internal: () => new ApiError(500, "internal_error", "Something went wrong on our side. Try again in a moment."),
};

function errorBody(error: ApiError): Record<string, unknown> {
  return {
    error: error.code,
    message: error.message,
    ...(error.extras.fields ? { fields: error.extras.fields } : {}),
    ...(error.extras.ride ? { ride: error.extras.ride } : {}),
  };
}

export function respondError(res: ServerResponse, error: ApiError): void {
  const payload = JSON.stringify(errorBody(error));
  res.writeHead(error.status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...(error.extras.retryAfterSeconds ? { "retry-after": String(error.extras.retryAfterSeconds) } : {}),
  });
  res.end(payload);
}
