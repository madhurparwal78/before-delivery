import type { ApiErrorBody } from '../../shared/contract.js';

export type ErrorCode =
  | 'cross_origin'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'not_found'
  | 'forbidden'
  | 'idempotency_key_required'
  | 'idempotency_conflict'
  | 'invalid_transition'
  | 'seat_taken'
  | 'already_holding'
  | 'calendar_conflict'
  | 'late_change'
  | 'already_verified'
  | 'not_billable'
  | 'duplicate_rate'
  | 'email_taken'
  | 'validation'
  | 'storage_unavailable';

const ERROR_DEFINITIONS: Record<ErrorCode, { status: number; message: string }> = {
  cross_origin: { status: 403, message: 'Cross-origin writes are not accepted.' },
  payload_too_large: { status: 413, message: 'The request body is too large.' },
  unsupported_media_type: { status: 415, message: 'This endpoint does not accept that content type.' },
  unauthenticated: { status: 401, message: 'Sign in to continue.' },
  invalid_credentials: { status: 401, message: 'Email or password is wrong.' },
  not_found: { status: 404, message: 'Not found.' },
  forbidden: { status: 403, message: 'Your role cannot do that.' },
  idempotency_key_required: { status: 400, message: 'A valid Idempotency-Key header is required.' },
  idempotency_conflict: { status: 409, message: 'That idempotency key was used with different details.' },
  invalid_transition: { status: 409, message: 'That change is not allowed in this state.' },
  seat_taken: { status: 409, message: 'Seat already taken' },
  already_holding: { status: 409, message: 'You already hold a seat on this request.' },
  calendar_conflict: { status: 409, message: 'This overlaps a seat you already hold.' },
  late_change: { status: 409, message: "Less than 48 business hours' notice. This request can only be cancelled now." },
  already_verified: { status: 409, message: 'This seat is already verified.' },
  not_billable: { status: 409, message: 'This item is not ready to invoice.' },
  duplicate_rate: { status: 409, message: 'A rate already starts on that date.' },
  email_taken: { status: 409, message: 'That email is already in use.' },
  validation: { status: 422, message: 'Check the highlighted fields.' },
  storage_unavailable: { status: 503, message: 'File storage is unavailable. Your form was not saved. Try again shortly.' },
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields: Record<string, string> | undefined;

  constructor(code: ErrorCode, fields?: Record<string, string>) {
    const definition = ERROR_DEFINITIONS[code];
    super(definition.message);
    this.name = 'ApiError';
    this.code = code;
    this.status = definition.status;
    this.fields = code === 'validation' ? (fields ?? {}) : undefined;
  }

  toBody(): ApiErrorBody {
    if (this.fields === undefined) {
      return { error: { code: this.code, message: this.message } };
    }
    return { error: { code: this.code, message: this.message, fields: this.fields } };
  }
}

export function fail(code: ErrorCode, fields?: Record<string, string>): never {
  throw new ApiError(code, fields);
}
