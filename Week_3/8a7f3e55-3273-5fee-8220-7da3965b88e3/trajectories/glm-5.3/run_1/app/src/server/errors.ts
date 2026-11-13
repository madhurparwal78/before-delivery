// The single error shape and precedence for the whole API.
import type { QuoteInfo } from '../shared/api.js';

export interface ErrorExtra {
  status?: string;
  quote?: QuoteInfo;
  pending_line_refs?: string[];
  relayline_total_cents?: number;
  billing_total_cents?: number;
  earliest_allowed?: string;
}

export type ErrorCode =
  | 'unauthenticated' | 'invalid_credentials' | 'forbidden' | 'cross_origin' | 'access_ended'
  | 'not_found' | 'idempotency_in_progress' | 'invalid_transition' | 'seat_filled'
  | 'already_holding' | 'schedule_conflict' | 'not_qualified' | 'open_call_closed' | 'already_team'
  | 'quote_changed' | 'pending_sync' | 'week_closed' | 'total_mismatch' | 'rate_would_reprice'
  | 'link_expired' | 'payload_too_large' | 'unsupported_type' | 'validation'
  | 'idempotency_key_reused' | 'billing_unavailable' | 'storage_unavailable';

const STATUS_FOR: Record<ErrorCode, number> = {
  unauthenticated: 401,
  invalid_credentials: 401,
  forbidden: 403,
  cross_origin: 403,
  access_ended: 403,
  not_found: 404,
  idempotency_in_progress: 409,
  invalid_transition: 409,
  seat_filled: 409,
  already_holding: 409,
  schedule_conflict: 409,
  not_qualified: 409,
  open_call_closed: 409,
  already_team: 409,
  quote_changed: 409,
  pending_sync: 409,
  week_closed: 409,
  total_mismatch: 409,
  rate_would_reprice: 409,
  link_expired: 410,
  payload_too_large: 413,
  unsupported_type: 415,
  validation: 422,
  idempotency_key_reused: 422,
  billing_unavailable: 503,
  storage_unavailable: 503,
};

export class ApiError extends Error {
  code: ErrorCode;
  fields?: Record<string, string>;
  extra: ErrorExtra;

  constructor(code: ErrorCode, message: string, options: { fields?: Record<string, string>; extra?: ErrorExtra } = {}) {
    super(message);
    this.code = code;
    this.fields = options.fields;
    this.extra = options.extra ?? {};
  }

  status(): number {
    return STATUS_FOR[this.code];
  }

  body(): { error: string; message: string; fields?: Record<string, string> } & ErrorExtra {
    const out = { error: this.code, message: this.message };
    if (this.fields) (out as Record<string, unknown>).fields = this.fields;
    for (const [key, value] of Object.entries(this.extra)) {
      if (value !== undefined) (out as unknown as Record<string, unknown>)[key] = value;
    }
    return out as { error: string; message: string; fields?: Record<string, string> } & ErrorExtra;
  }
}

export function validationError(fields: Record<string, string>): ApiError {
  const first = Object.values(fields)[0] ?? 'Check the highlighted fields.';
  return new ApiError('validation', first, { fields });
}
