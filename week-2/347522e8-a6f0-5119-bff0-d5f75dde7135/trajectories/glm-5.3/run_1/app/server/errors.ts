// The single shared error shape and the API's precedence order. Every
// endpoint's failure is expressed as one of these codes, in this order.

export class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(status: number, error: string, body: Record<string, unknown> = {}) {
    super(error);
    this.status = status;
    this.body = { error, ...body };
  }

  static payloadTooLarge(): ApiError {
    return new ApiError(413, "payload_too_large");
  }

  static crossOrigin(): ApiError {
    return new ApiError(403, "cross_origin");
  }

  static readOnly(): ApiError {
    return new ApiError(405, "read_only");
  }

  static unsupportedMediaType(): ApiError {
    return new ApiError(415, "unsupported_media_type");
  }

  static unauthenticated(): ApiError {
    return new ApiError(401, "unauthenticated");
  }

  static notFound(): ApiError {
    return new ApiError(404, "not_found");
  }

  static forbidden(): ApiError {
    return new ApiError(403, "forbidden");
  }

  static validationError(errors: Record<string, string>): ApiError {
    return new ApiError(422, "validation", { errors });
  }

  static fileTooLarge(): ApiError {
    return new ApiError(413, "file_too_large");
  }

  static unsupportedType(): ApiError {
    return new ApiError(415, "unsupported_type");
  }

  static invalidCredentials(): ApiError {
    return new ApiError(401, "invalid_credentials");
  }

  static idempotencyConflict(): ApiError {
    return new ApiError(409, "idempotency_conflict");
  }

  static invalidTransition(from: string, to: string): ApiError {
    return new ApiError(409, "invalid_transition", { from, to });
  }

  static holdExpired(): ApiError {
    return new ApiError(409, "hold_expired");
  }

  static renterNotActive(): ApiError {
    return new ApiError(409, "renter_not_active");
  }

  static renterOffboarded(): ApiError {
    return new ApiError(409, "renter_offboarded");
  }

  static complianceLapsed(): ApiError {
    return new ApiError(409, "compliance_lapsed");
  }

  static alreadyRevoked(): ApiError {
    return new ApiError(409, "already_revoked");
  }

  static alreadySubscribed(): ApiError {
    return new ApiError(409, "already_subscribed");
  }

  static notSubscribed(): ApiError {
    return new ApiError(409, "not_subscribed");
  }

  static stationInUse(): ApiError {
    return new ApiError(409, "station_in_use");
  }

  static slotConflict(date: string, legalEnd: string | null, blockedBy: string, blockedAt: string): ApiError {
    return new ApiError(409, "slot_conflict", {
      date,
      legal_end: legalEnd,
      blocked_by: blockedBy,
      blocked_at: blockedAt,
    });
  }

  static insufficientHours(balanceMinutes: number, neededMinutes: number): ApiError {
    return new ApiError(409, "insufficient_hours", {
      balance_minutes: balanceMinutes,
      needed_minutes: neededMinutes,
    });
  }

  static documentsIncomplete(): ApiError {
    return new ApiError(409, "documents_incomplete");
  }

  static documentExpired(): ApiError {
    return new ApiError(409, "document_expired");
  }

  static hasFutureBookings(): ApiError {
    return new ApiError(409, "has_future_bookings");
  }

  static billingUnavailable(): ApiError {
    return new ApiError(503, "billing_unavailable");
  }

  static paymentFailed(): ApiError {
    return new ApiError(402, "payment_failed");
  }

  static storageUnavailable(): ApiError {
    return new ApiError(503, "storage_unavailable");
  }
}

export const isApiError = (err: unknown): err is ApiError => err instanceof ApiError;
