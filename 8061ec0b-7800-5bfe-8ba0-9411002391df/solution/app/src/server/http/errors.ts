// The one error shape: {"error":{"code","message", …}}. Handlers throw an ApiError; the router writes it.

import type { ApiErrorBody, AvailabilityItem, Quote } from "../../shared/api.js";

type Extra = { fields?: Record<string, string>; alternatives?: AvailabilityItem[]; quote?: Quote; photo_index?: number };

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly extra: Extra = {}) {
    super(message);
  }

  body(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, ...this.extra } };
  }
}

export function notFound(code = "not_found", message = "Not found."): ApiError {
  return new ApiError(404, code, message);
}

export function invalidTransition(): ApiError {
  return new ApiError(409, "invalid_transition", "That move is not allowed from the contract's current state.");
}

export function validationFailed(fields: Record<string, string>): ApiError {
  return new ApiError(422, "validation_failed", "Some fields are invalid.", { fields });
}

export function billingUnavailable(): ApiError {
  return new ApiError(503, "billing_unavailable", "Billing is unreachable. Nothing was changed.");
}

export function storageUnavailable(): ApiError {
  return new ApiError(503, "storage_unavailable", "File storage is unreachable. Nothing was changed.");
}

/** A Kill Bill transaction already holds the action's external key with a different amount. */
export function idempotencyConflict(): ApiError {
  return new ApiError(409, "idempotency_conflict", "This idempotency key was already used for a different request.");
}
