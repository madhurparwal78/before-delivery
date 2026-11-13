import type { ApiErrorBody, BookingStatus, ErrorCode, Quote } from '../../shared/api.js';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
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

const MESSAGE_BY_CODE: Record<ErrorCode, string> = {
  unauthenticated: 'Sign in to continue.',
  invalid_credentials: 'That email and password do not match an account.',
  forbidden: 'Your role may not take that action.',
  cross_origin: 'Cross-origin writes are refused.',
  access_ended: 'Access to these prep materials has ended.',
  not_found: 'That record is not available to you.',
  idempotency_in_progress: 'An earlier request with this idempotency key is still running.',
  invalid_transition: 'That change is not allowed from the booking\u2019s current status.',
  seat_filled: 'Another interpreter already holds that seat.',
  already_holding: 'That interpreter already holds a seat on this booking.',
  schedule_conflict: 'That interpreter already has an assignment at this time.',
  not_qualified: 'That interpreter\u2019s credentials do not cover this setting.',
  open_call_closed: 'The open call for this booking has closed.',
  already_team: 'This booking already has a team of two.',
  quote_changed: 'The cancellation charge changed since the quote.',
  pending_sync: 'Some invoice lines are still waiting to sync with billing.',
  week_closed: 'That billing week is already closed.',
  total_mismatch: 'The Relayline and billing totals differ.',
  rate_would_reprice: 'That effective date would reprice work that has already been billed.',
  link_expired: 'That download link has expired.',
  payload_too_large: 'That request body is larger than the limit.',
  unsupported_type: 'That file kind is not accepted.',
  validation: 'Some fields need attention.',
  idempotency_key_reused: 'That idempotency key was already used for a different request.',
  billing_unavailable: 'The billing system is unreachable right now.',
  storage_unavailable: 'File storage is unreachable right now.',
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly extra: Omit<ApiErrorBody, 'error' | 'message'>;

  constructor(code: ErrorCode, extra: Omit<ApiErrorBody, 'error' | 'message'> = {}) {
    super(MESSAGE_BY_CODE[code]);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.extra = extra;
  }

  body(): ApiErrorBody {
    return { error: this.code, message: this.message, ...this.extra };
  }
}

export function apiError(code: ErrorCode): ApiError {
  return new ApiError(code);
}

export function validationError(fields: Record<string, string>): ApiError {
  return new ApiError('validation', { fields });
}

export function invalidTransition(status: BookingStatus): ApiError {
  return new ApiError('invalid_transition', { status });
}

export function quoteChanged(quote: Quote): ApiError {
  return new ApiError('quote_changed', { quote });
}

export const FIELD_MESSAGES = {
  org_id: 'Choose a client organisation.',
  setting: 'Choose medical, educational, legal or workplace.',
  title: 'Enter a title of up to 120 characters.',
  location: 'Enter where the interpreter should go.',
  onsite_contact_name: 'Name the person who meets the interpreter.',
  onsite_contact_phone: 'Enter a phone number for the on-site contact.',
  consumer_name: 'Enter the Deaf consumer\u2019s name.',
  start_malformed: 'Enter a start date and time.',
  start_nonexistent: 'That time doesn\u2019t exist in agency time on that date.',
  start_too_soon: 'Start must be at least 15 minutes from now.',
  duration_minutes: 'Length must be 30 to 480 minutes in 15-minute steps.',
  requester_notes: 'Notes can be up to 1,000 characters.',
  interpreter_id: 'Choose an interpreter.',
  seat: 'Choose a seat this booking has.',
  q: 'Search text can be up to 80 characters.',
  worked_minutes: 'Worked minutes must be a whole number from 1 to 720.',
  mileage_miles: 'Mileage must be a whole number from 0 to 500.',
  quoted_charge_cents: 'Confirm the quoted charge.',
  idempotency_key: 'Idempotency-Key must be 1 to 100 visible ASCII characters.',
  file_missing: 'Choose a file to upload. A non-empty file is required.',
  file_booking_full: 'A booking can hold up to 10 files.',
  effective_from_past: 'Choose a date after today.',
  effective_from_duplicate: 'A rate already starts on that date.',
  hourly_rate_cents: 'Enter an hourly rate from $0.01 to $1,000.00.',
  team_surcharge_bp: 'Enter a surcharge from 0 to 100 percent.',
  mileage_cents_per_mile: 'Enter a mileage rate from 0 to 1,000 cents.',
  week_start: 'Choose a Monday that is not in the future.',
  range: 'Choose a range of at most 31 days.',
} as const;
