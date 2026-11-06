/** The one API error shape and its precedence order. */

export type ErrorCode =
  | "cross_origin"
  | "unauthenticated"
  | "invalid_credentials"
  | "tenant_offboarded"
  | "idempotency_conflict"
  | "not_found"
  | "forbidden"
  | "idempotency_key_required"
  | "body_too_large"
  | "file_too_large"
  | "unsupported_media_type"
  | "unsupported_file_type"
  | "validation_failed"
  | "method_not_allowed"
  | "read_only"
  | "slot_taken"
  | "tenant_not_active"
  | "document_expires_before_booking"
  | "hold_expired"
  | "invalid_transition"
  | "outside_check_in_window"
  | "not_started"
  | "already_started"
  | "documents_incomplete"
  | "open_bookings"
  | "stale_version"
  | "insufficient_hours"
  | "file_missing"
  | "invoice_paid"
  | "fee_invoiced"
  | "nothing_to_invoice"
  | "link_expired"
  | "billing_unavailable"
  | "storage_unavailable"
  | "mail_unavailable"
  | "internal";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
  }

  body(): string {
    return JSON.stringify({ error: { code: this.code, message: this.message, details: this.details } });
  }
}

export const err = (status: number, code: ErrorCode, message: string, details: Record<string, unknown> = {}): ApiError =>
  new ApiError(status, code, message, details);

export const notFound = (): ApiError => err(404, "not_found", "That record isn't available.");
export const forbidden = (): ApiError => err(403, "forbidden", "You can't do that with this account.");
export const unauthenticated = (): ApiError => err(401, "unauthenticated", "Sign in to continue.");

export class ProviderError extends Error {
  constructor(
    readonly provider: "billing" | "storage" | "mail",
    cause: Error | string
  ) {
    super(typeof cause === "string" ? cause : cause.message);
  }

  apiError(): ApiError {
    switch (this.provider) {
      case "billing":
        return err(503, "billing_unavailable", "Billing is unreachable. Nothing was changed; try again in a moment.");
      case "storage":
        return err(503, "storage_unavailable", "Document storage is unreachable. Nothing was changed; try again in a moment.");
      case "mail":
        return err(503, "mail_unavailable", "Email is unreachable. Nothing was changed; try again in a moment.");
    }
  }
}

export const validation = (details: Record<string, string>): ApiError =>
  err(422, "validation_failed", "Check the highlighted fields.", details);
