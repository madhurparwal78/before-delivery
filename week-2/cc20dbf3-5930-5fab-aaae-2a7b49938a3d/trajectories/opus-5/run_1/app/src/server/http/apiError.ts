import {
  BILLING_UNAVAILABLE_LENDING,
  BILLING_UNAVAILABLE_SETTLEMENT,
  ERROR_COPY,
  invalidTransitionCopy,
  settlementMismatchCopy,
  type ApiErrorBody,
  type ErrorCode,
} from '../../shared/errors.js';
import { formatMoney } from '../../domain/money.js';

/** Every API error is produced through this one shape. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly copy: string;
  readonly fields: Record<string, string> | null;

  constructor(status: number, code: ErrorCode, copy: string, fields: Record<string, string> | null = null) {
    super(copy);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.copy = copy;
    this.fields = fields;
  }

  body(): ApiErrorBody {
    if (this.fields !== null) {
      return { error: { code: this.code, message: this.copy, fields: this.fields } };
    }
    return { error: { code: this.code, message: this.copy } };
  }
}

type SimpleCode = keyof typeof ERROR_COPY;

const STATUS_BY_CODE: Record<SimpleCode, number> = {
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
  idempotency_conflict: 409,
  request_in_progress: 409,
  photo_limit: 409,
  unsupported_photo: 415,
  photo_too_large: 413,
  not_settled: 409,
  photo_storage_unavailable: 503,
};

export function fail(code: SimpleCode): ApiError {
  return new ApiError(STATUS_BY_CODE[code], code, ERROR_COPY[code]);
}

export function failValidation(fields: Record<string, string>): ApiError {
  return new ApiError(422, 'validation', ERROR_COPY.validation, fields);
}

export function failTransition(subject: 'hold' | 'loan', statusWord: string): ApiError {
  return new ApiError(409, 'invalid_transition', invalidTransitionCopy(subject, statusWord));
}

export function failSettlementMismatch(fixedDamageCents: number): ApiError {
  return new ApiError(409, 'settlement_mismatch', settlementMismatchCopy(formatMoney(fixedDamageCents)));
}

export function failBillingLending(): ApiError {
  return new ApiError(503, 'billing_unavailable', BILLING_UNAVAILABLE_LENDING);
}

export function failBillingSettlement(): ApiError {
  return new ApiError(503, 'billing_unavailable', BILLING_UNAVAILABLE_SETTLEMENT);
}
