import { messageFor, type ErrorCode, type ErrorContext } from '../shared/copy.js';
import type { ApiErrorBody } from '../shared/types.js';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  unauthenticated: 401,
  not_found: 404,
  forbidden: 403,
  forbidden_origin: 403,
  lead_only: 403,
  idempotency_key_required: 400,
  idempotency_conflict: 409,
  payload_too_large: 413,
  unsupported_media_type: 415,
  validation_failed: 422,
  email_taken: 409,
  invalid_credentials: 401,
  accounts_unavailable: 503,
  billing_unavailable: 503,
  storage_unavailable: 503,
  card_declined: 402,
  booking_closed: 409,
  sold_out: 409,
  currency_locked: 409,
  already_member: 409,
  same_tier: 409,
  change_pending: 409,
  payment_overdue: 409,
  nothing_pending: 409,
  nothing_due: 409,
  not_a_member: 409,
  illegal_transition: 409,
  not_editable: 409,
  session_not_cancellable: 409,
  fully_refunded: 409,
  price_change_conflict: 409,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: Record<string, string>;

  constructor(code: ErrorCode, options: { context?: ErrorContext; fields?: Record<string, string> } = {}) {
    super(messageFor(code, options.context ?? {}));
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.fields = options.fields;
  }

  body(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.code === 'validation_failed' ? { fields: this.fields ?? {} } : {}),
      },
    };
  }
}
