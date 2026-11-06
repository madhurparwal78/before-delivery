// The single error type and shape (brief: API › Error shape). Every API error leaves through
// ApiError and is written by writeError in http.ts.
import type { Hold, Item } from "../shared/api.js";

type ConflictCode =
  | "bay_occupied"
  | "bay_too_small"
  | "bay_class_change"
  | "car_released"
  | "insufficient_items"
  | "report_already_signed"
  | "car_not_stored"
  | "job_already_open"
  | "invalid_transition"
  | "estimate_expired"
  | "stage_already_logged"
  | "stage_out_of_order"
  | "already_paid"
  | "car_in_workshop"
  | "release_already_open"
  | "slot_taken"
  | "idempotency_conflict"
  | "cannot_change_own_access";

type ErrorPayload =
  | { error: string }
  | { error: "belongings_checked_in"; items: Item[] }
  | { error: "invoice_unpaid"; invoices: Hold[] }
  | { errors: Record<string, string> };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly payload: ErrorPayload,
  ) {
    super(typeof (payload as { error?: string }).error === "string" ? (payload as { error: string }).error : "validation");
  }
}

export const unauthenticated = (): ApiError => new ApiError(401, { error: "unauthenticated" });
export const accessRevoked = (): ApiError => new ApiError(401, { error: "access_revoked" });
export const sessionExpired = (): ApiError => new ApiError(401, { error: "session_expired" });
export const invalidCredentials = (): ApiError => new ApiError(401, { error: "invalid_credentials" });
export const forbidden = (): ApiError => new ApiError(403, { error: "forbidden" });
export const notFound = (): ApiError => new ApiError(404, { error: "not_found" });
export const conflict = (code: ConflictCode): ApiError => new ApiError(409, { error: code });
export const estimateChanged = (): ApiError => new ApiError(412, { error: "estimate_changed" });
export const payloadTooLarge = (): ApiError => new ApiError(413, { error: "payload_too_large" });
export const unsupportedMediaType = (): ApiError => new ApiError(415, { error: "unsupported_media_type" });
export const storageUnavailable = (): ApiError => new ApiError(503, { error: "storage_unavailable" });
export const billingUnavailable = (): ApiError => new ApiError(503, { error: "billing_unavailable" });
export const mailUnavailable = (): ApiError => new ApiError(503, { error: "mail_unavailable" });
export const belongingsCheckedIn = (items: Item[]): ApiError => new ApiError(409, { error: "belongings_checked_in", items });
export const invoiceUnpaid = (invoices: Hold[]): ApiError => new ApiError(409, { error: "invoice_unpaid", invoices });

/** Field errors collected in check order, then thrown as one 422. */
export class FieldErrors {
  private readonly errors: Record<string, string> = {};

  add(field: string, message: string): void {
    if (!(field in this.errors)) this.errors[field] = message;
  }

  has(field: string): boolean {
    return field in this.errors;
  }

  throwIfAny(): void {
    if (Object.keys(this.errors).length > 0) throw new ApiError(422, { errors: { ...this.errors } });
  }
}

/** A single-field 422. */
export function invalid(field: string, message: string): ApiError {
  return new ApiError(422, { errors: { [field]: message } });
}

/** A provider that did not answer (connection refused, timeout, 5xx). */
export class ProviderDown extends Error {}
