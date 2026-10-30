// The one API error type and the one place an error body is written.

import type { ServerResponse } from "node:http";
import {
  BILLING_OFFLINE_LEND,
  BILLING_OFFLINE_SETTLE,
  ERROR_COPY,
  type ErrorCode,
  invalidTransitionCopy,
  settlementMismatchCopy,
} from "../../shared/copy.js";

type FixedCode = keyof typeof ERROR_COPY;

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  bad_credentials: 401,
  forbidden: 403,
  not_found: 404,
  cross_origin: 403,
  unsupported_media_type: 415,
  body_too_large: 413,
  validation: 422,
  no_unit_free: 409,
  unit_busy: 409,
  hold_expired: 409,
  borrowing_paused: 409,
  borrowing_limit: 409,
  renewal_used: 409,
  invalid_transition: 409,
  idempotency_conflict: 409,
  request_in_progress: 409,
  photo_limit: 409,
  unsupported_photo: 415,
  photo_too_large: 413,
  not_settled: 409,
  settlement_mismatch: 409,
  billing_unavailable: 503,
  photo_storage_unavailable: 503,
  internal: 500,
};

export class ApiError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    readonly copy: string,
    readonly fields?: Record<string, string>,
  ) {
    super(code);
    this.status = STATUS[code];
  }

  static of(code: FixedCode): ApiError {
    return new ApiError(code, ERROR_COPY[code]);
  }

  static validation(fields: Record<string, string>): ApiError {
    return new ApiError("validation", ERROR_COPY.validation, fields);
  }

  static invalidTransition(kind: "hold" | "loan", status: string): ApiError {
    return new ApiError("invalid_transition", invalidTransitionCopy(kind, status));
  }

  static settlementMismatch(fixedDamageCents: number): ApiError {
    return new ApiError("settlement_mismatch", settlementMismatchCopy(fixedDamageCents));
  }

  static billingUnavailable(action: "lend" | "settle"): ApiError {
    return new ApiError("billing_unavailable", action === "lend" ? BILLING_OFFLINE_LEND : BILLING_OFFLINE_SETTLE);
  }
}

/** Collects field errors and throws one validation error when any were found. */
export class FieldErrors {
  private readonly fields: Record<string, string> = {};

  add(field: string, copy: string): void {
    this.fields[field] ??= copy;
  }

  has(field: string): boolean {
    return field in this.fields;
  }

  throwIfAny(): void {
    if (Object.keys(this.fields).length > 0) throw ApiError.validation(this.fields);
  }
}

export function writeError(res: ServerResponse, error: ApiError): void {
  const body = { error: { code: error.code, message: error.copy, ...(error.fields ? { fields: error.fields } : {}) } };
  const payload = JSON.stringify(body);
  res.writeHead(error.status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}
