/**
 * The single error body and the single precedence order. Every API error is
 * produced through `ApiError` and rendered by the central handler in
 * `api/router.ts`; no route builds its own error body.
 */

export type ErrorCode =
  | "cross_origin"
  | "payload_too_large"
  | "unsupported_media_type"
  | "unauthenticated"
  | "invalid_credentials"
  | "not_found"
  | "link_signed"
  | "link_expired"
  | "file_link_expired"
  | "forbidden"
  | "invalid_transition"
  | "drops_delivered"
  | "drops_not_delivered"
  | "drops_not_accepted"
  | "not_enough_open_hives"
  | "already_settled"
  | "idempotency_key_reused"
  | "validation_failed"
  | "billing_unavailable"
  | "storage_unavailable";

export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
  remaining?: number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields?: Record<string, string>;
  readonly remaining?: number;

  constructor(status: number, code: ErrorCode, message: string, extra?: { fields?: Record<string, string>; remaining?: number }) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = extra?.fields;
    this.remaining = extra?.remaining;
  }

  body(): ApiErrorBody {
    const body: ApiErrorBody = { error: this.code, message: this.message };
    if (this.fields && Object.keys(this.fields).length > 0) body.fields = this.fields;
    if (this.remaining !== undefined) body.remaining = this.remaining;
    return body;
  }

  static unauthenticated(): ApiError {
    return new ApiError(401, "unauthenticated", "Sign in to use Bloom Desk.");
  }

  static notFound(): ApiError {
    return new ApiError(404, "not_found", "That record isn't available to you.");
  }

  static forbidden(): ApiError {
    return new ApiError(403, "forbidden", "You may not do that.");
  }

  static invalidTransition(ref: string, statusLabel: string): ApiError {
    return new ApiError(409, "invalid_transition", `That can't be done while ${ref} is ${statusLabel}.`);
  }

  static crossOrigin(): ApiError {
    return new ApiError(403, "cross_origin", "Writes are accepted only from Bloom Desk itself.");
  }

  static validation(fields: Record<string, string>): ApiError {
    const first = Object.values(fields)[0] ?? "Check the highlighted fields.";
    return new ApiError(422, "validation_failed", first, { fields });
  }

  static billing(): ApiError {
    return new ApiError(503, "billing_unavailable", "Billing is unreachable right now. Try again in a minute.");
  }

  static storage(): ApiError {
    return new ApiError(503, "storage_unavailable", "File storage is unreachable right now. Try again in a minute.");
  }
}
