/**
 * The one API error shape: `{"error":code}`, plus `errors` when the status is 422.
 * Every route raises these; nothing else writes an error body.
 */

export type FieldCode = "required" | "invalid" | "too_long" | "too_short" | "out_of_range" | string;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly fields?: Record<string, FieldCode>,
    /** Some errors publish the order or an available count alongside the code. */
    readonly extra?: Record<string, unknown>,
  ) {
    super(`${status} ${code}`);
    this.name = "ApiError";
  }

  body(): Record<string, unknown> {
    const body: Record<string, unknown> = { error: this.code, ...this.extra };
    if (this.fields) body.errors = this.fields;
    return body;
  }
}

// Request framing (precedence step 1).
export const payloadTooLarge = (): ApiError => new ApiError(413, "payload_too_large");
export const unsupportedMediaType = (): ApiError => new ApiError(415, "unsupported_media_type");
export const invalidJson = (): ApiError => new ApiError(400, "invalid_json");
export const crossOrigin = (): ApiError => new ApiError(403, "cross_origin");

// Identity and role (steps 2, 3, 6).
export const unauthenticated = (): ApiError => new ApiError(401, "unauthenticated");
export const forbidden = (): ApiError => new ApiError(403, "forbidden");
export const tradeAccountRequired = (): ApiError => new ApiError(403, "trade_account_required");
export const ownerOnly = (): ApiError => new ApiError(403, "owner_only");

// Idempotency (step 4).
export const idempotencyKeyRequired = (): ApiError => new ApiError(400, "idempotency_key_required");
export const idempotencyConflict = (): ApiError => new ApiError(409, "idempotency_conflict");
export const requestInProgress = (): ApiError => new ApiError(409, "request_in_progress");

// Missing resources (step 5).
export const notFound = (): ApiError => new ApiError(404, "not_found");
export const unknownVariant = (): ApiError => new ApiError(404, "unknown_variant");
export const unknownToken = (): ApiError => new ApiError(404, "unknown_token");

// State conflicts (step 7).
export const invalidState = (status: string): ApiError => new ApiError(409, "invalid_state", undefined, { status });
export const insufficientStock = (available: number): ApiError =>
  new ApiError(409, "insufficient_stock", undefined, { available });
export const emptyCart = (): ApiError => new ApiError(409, "empty_cart");
export const placementExceedsQuantity = (): ApiError => new ApiError(409, "placement_exceeds_quantity");
export const placementsOutsideRoom = (): ApiError => new ApiError(409, "placements_outside_room");
export const stockBelowZero = (): ApiError => new ApiError(409, "stock_below_zero");
export const pdfNotReady = (): ApiError => new ApiError(409, "pdf_not_ready");
export const emailTaken = (): ApiError => new ApiError(409, "email_taken");

// Validation (step 8).
export const validation = (fields: Record<string, FieldCode>): ApiError => new ApiError(422, "validation", fields);

// Payment outcomes and provider outages (step 9).
export const cardDeclined = (order: unknown): ApiError =>
  new ApiError(402, "card_declined", undefined, { order });
export const paymentUnavailable = (extra?: Record<string, unknown>): ApiError =>
  new ApiError(503, "payment_unavailable", undefined, extra);
export const storageUnavailable = (): ApiError => new ApiError(503, "storage_unavailable");
export const collaborationUnavailable = (): ApiError => new ApiError(503, "collaboration_unavailable");
export const invalidCredentials = (): ApiError => new ApiError(401, "invalid_credentials");
