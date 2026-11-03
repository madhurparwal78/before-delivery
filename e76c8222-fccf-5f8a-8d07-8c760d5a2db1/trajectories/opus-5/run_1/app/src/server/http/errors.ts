import { GateResult, Quote, RequestStatus, OfferStatus, UserSummary } from '../../shared/types';

export type ErrorCode =
  | 'bad_json'
  | 'idempotency_key_required'
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'forbidden'
  | 'cross_origin'
  | 'not_found'
  | 'invalid_transition'
  | 'already_started'
  | 'seat_taken'
  | 'offer_window_closed'
  | 'not_yet_ended'
  | 'already_submitted'
  | 'fee_changed'
  | 'idempotency_conflict'
  | 'offer_closed'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'validation'
  | 'gate_failed'
  | 'billing_unavailable'
  | 'storage_unavailable';

const ERROR_TABLE: Record<ErrorCode, { status: number; message: string }> = {
  bad_json: { status: 400, message: 'The request body is not valid JSON.' },
  idempotency_key_required: { status: 400, message: 'An Idempotency-Key header is required.' },
  unauthenticated: { status: 401, message: 'Sign in to continue.' },
  invalid_credentials: { status: 401, message: 'That email and passcode do not match.' },
  forbidden: { status: 403, message: 'Your role may not use this action.' },
  cross_origin: { status: 403, message: 'Cross-origin requests are refused.' },
  not_found: { status: 404, message: 'No such record.' },
  invalid_transition: { status: 409, message: 'That change is not allowed in the current state.' },
  already_started: { status: 409, message: 'This assignment has started and can no longer be cancelled.' },
  seat_taken: { status: 409, message: 'That seat is already taken.' },
  offer_window_closed: { status: 409, message: 'Too late to send an offer for this seat.' },
  not_yet_ended: { status: 409, message: 'You can submit after the assignment ends.' },
  already_submitted: { status: 409, message: 'A timesheet for this seat has already been submitted.' },
  fee_changed: { status: 409, message: 'The cancellation charge has changed.' },
  idempotency_conflict: { status: 409, message: 'That idempotency key was used with a different body.' },
  offer_closed: { status: 410, message: 'This offer is no longer open.' },
  payload_too_large: { status: 413, message: 'That body or file is too large.' },
  unsupported_media_type: { status: 415, message: 'That file type is not supported.' },
  validation: { status: 422, message: 'Check the highlighted fields.' },
  gate_failed: { status: 422, message: 'A dispatch gate failed.' },
  billing_unavailable: { status: 503, message: 'Billing is unreachable.' },
  storage_unavailable: { status: 503, message: 'File storage is unreachable.' },
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly extra: Record<string, unknown>;

  constructor(code: ErrorCode, extra: Record<string, unknown> = {}, message?: string) {
    const entry = ERROR_TABLE[code];
    super(message ?? entry.message);
    this.code = code;
    this.status = entry.status;
    this.extra = extra;
  }

  body(): Record<string, unknown> {
    return { error: { code: this.code, message: this.message }, ...this.extra };
  }
}

export const fail = (code: ErrorCode, extra?: Record<string, unknown>): ApiError =>
  new ApiError(code, extra);

export const notFound = (): ApiError => new ApiError('not_found');

export const invalidTransition = (from: RequestStatus | string): ApiError =>
  new ApiError('invalid_transition', { from });

export const seatTaken = (holder: UserSummary): ApiError =>
  new ApiError('seat_taken', { holder: { id: holder.id, name: holder.name } });

export const offerClosed = (status: OfferStatus): ApiError =>
  new ApiError('offer_closed', { offer_status: status });

export const feeChanged = (quote: Quote): ApiError => new ApiError('fee_changed', { quote });

export const validationFailed = (fields: Record<string, string>): ApiError =>
  new ApiError('validation', { fields });

export const gateFailed = (gates: GateResult[]): ApiError => {
  const firstFailing = gates.find((gate) => !gate.pass);
  return new ApiError(
    'gate_failed',
    { gate: firstFailing ? firstFailing.gate : null, gates },
    firstFailing && firstFailing.reason ? firstFailing.reason : ERROR_TABLE.gate_failed.message,
  );
};
