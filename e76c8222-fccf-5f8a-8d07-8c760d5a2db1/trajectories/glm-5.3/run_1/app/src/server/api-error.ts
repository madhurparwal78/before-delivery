// Every API error is produced through this one shape and this one table.
export type ErrorCode =
  | 'bad_json' | 'idempotency_key_required' | 'unauthenticated' | 'invalid_credentials'
  | 'forbidden' | 'cross_origin' | 'not_found' | 'invalid_transition' | 'already_started'
  | 'seat_taken' | 'offer_window_closed' | 'not_yet_ended' | 'already_submitted'
  | 'fee_changed' | 'idempotency_conflict' | 'offer_closed' | 'payload_too_large'
  | 'unsupported_media_type' | 'validation' | 'gate_failed' | 'billing_unavailable'
  | 'storage_unavailable';

const STATUS_TABLE: Record<ErrorCode, number> = {
  bad_json: 400,
  idempotency_key_required: 400,
  unauthenticated: 401,
  invalid_credentials: 401,
  forbidden: 403,
  cross_origin: 403,
  not_found: 404,
  invalid_transition: 409,
  already_started: 409,
  seat_taken: 409,
  offer_window_closed: 409,
  not_yet_ended: 409,
  already_submitted: 409,
  fee_changed: 409,
  idempotency_conflict: 409,
  offer_closed: 410,
  payload_too_large: 413,
  unsupported_media_type: 415,
  validation: 422,
  gate_failed: 422,
  billing_unavailable: 503,
  storage_unavailable: 503,
};

export interface ApiErrorExtras {
  holder?: { id: string; name: string };
  from?: string;
  offer_status?: 'accepted' | 'declined' | 'expired' | 'withdrawn';
  quote?: unknown;
  fields?: Record<string, string>;
  gate?: 'credential' | 'validity' | 'schedule' | 'consumer';
  gates?: unknown[];
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly extras: ApiErrorExtras;

  constructor(code: ErrorCode, message: string, extras: ApiErrorExtras = {}) {
    super(message);
    this.code = code;
    this.status = STATUS_TABLE[code];
    this.extras = extras;
  }

  body(): string {
    const { error } = this.payload();
    return JSON.stringify({ error });
  }

  payload(): { error: { code: ErrorCode; message: string } & ApiErrorExtras } {
    const err: { code: ErrorCode; message: string } & ApiErrorExtras = {
      code: this.code,
      message: this.message,
    };
    for (const [k, v] of Object.entries(this.extras)) {
      if (v !== undefined) (err as unknown as Record<string, unknown>)[k] = v;
    }
    return { error: err };
  }
}

export function errorMessage(code: ErrorCode, context: Record<string, string> = {}): string {
  switch (code) {
    case 'bad_json': return 'The request body is not valid JSON.';
    case 'idempotency_key_required': return 'An Idempotency-Key header is required.';
    case 'unauthenticated': return 'Sign in first.';
    case 'invalid_credentials': return 'That email and passcode do not match.';
    case 'forbidden': return 'Your role may not perform this action.';
    case 'cross_origin': return 'Requests from other origins are not allowed.';
    case 'not_found': return 'Nothing was found here.';
    case 'invalid_transition': return `This request can no longer be changed from ${context.from}.`;
    case 'already_started': return 'This assignment has already started.';
    case 'seat_taken': return 'Seat taken by another coordinator.';
    case 'offer_window_closed': return 'Too late to send an offer for this seat.';
    case 'not_yet_ended': return 'You can submit after the assignment ends.';
    case 'already_submitted': return 'A timesheet has already been submitted for this seat.';
    case 'fee_changed': return 'The charge has changed. Review it and confirm again.';
    case 'idempotency_conflict': return 'This idempotency key was used with a different body.';
    case 'offer_closed': return `This offer is no longer open (${context.status}).`;
    case 'payload_too_large': return 'The upload is too large.';
    case 'unsupported_media_type': return 'This file type is not supported.';
    case 'validation': return 'Check the highlighted fields.';
    case 'gate_failed': return 'Not offered.';
    case 'billing_unavailable': return 'Billing is unreachable right now.';
    case 'storage_unavailable': return 'File storage is unreachable.';
  }
}

export function apiError(code: ErrorCode, extras: ApiErrorExtras = {}, context: Record<string, string> = {}): ApiError {
  return new ApiError(code, errorMessage(code, context), extras);
}
