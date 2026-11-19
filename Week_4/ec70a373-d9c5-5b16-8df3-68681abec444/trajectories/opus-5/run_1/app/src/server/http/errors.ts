import type { ApiErrorBody, AuditOutcome } from '../../shared/types';

export type ErrorCode =
  | 'not_found'
  | 'method_not_allowed'
  | 'read_only'
  | 'forbidden'
  | 'csrf_failed'
  | 'cross_origin'
  | 'unauthenticated'
  | 'session_invalid'
  | 'session_expired'
  | 'invalid_credentials'
  | 'too_many_attempts'
  | 'validation'
  | 'certificate_expired'
  | 'cutoff'
  | 'hold_limit'
  | 'insufficient_hours'
  | 'document_expired'
  | 'slot_taken'
  | 'series_conflict'
  | 'rate_exists'
  | 'invalid_transition'
  | 'hold_expired'
  | 'too_early'
  | 'too_late'
  | 'visit_open'
  | 'idempotency_conflict'
  | 'idempotency_in_progress'
  | 'body_too_large'
  | 'file_too_large'
  | 'unsupported_media_type'
  | 'unsupported_type'
  | 'billing_unavailable'
  | 'storage_unavailable'
  | 'link_expired'
  | 'link_revoked'
  | 'internal';

const CODE_STATUS: Record<ErrorCode, number> = {
  not_found: 404,
  method_not_allowed: 405,
  read_only: 405,
  forbidden: 403,
  csrf_failed: 403,
  cross_origin: 403,
  unauthenticated: 401,
  session_invalid: 401,
  session_expired: 401,
  invalid_credentials: 401,
  too_many_attempts: 429,
  validation: 422,
  certificate_expired: 422,
  cutoff: 422,
  hold_limit: 422,
  insufficient_hours: 422,
  document_expired: 422,
  slot_taken: 409,
  series_conflict: 409,
  rate_exists: 409,
  invalid_transition: 409,
  hold_expired: 409,
  too_early: 409,
  too_late: 409,
  visit_open: 409,
  idempotency_conflict: 409,
  idempotency_in_progress: 409,
  body_too_large: 413,
  file_too_large: 413,
  unsupported_media_type: 415,
  unsupported_type: 415,
  billing_unavailable: 503,
  storage_unavailable: 503,
  link_expired: 410,
  link_revoked: 410,
  internal: 500,
};

const CODE_MESSAGE: Record<ErrorCode, string> = {
  not_found: 'Not found.',
  method_not_allowed: 'That method is not allowed here.',
  read_only: 'This link is read-only.',
  forbidden: 'Your role cannot use this endpoint.',
  csrf_failed: 'The CSRF token did not match this session.',
  cross_origin: 'Writes are accepted from this origin only.',
  unauthenticated: 'Sign in to continue.',
  session_invalid: 'This session is no longer valid.',
  session_expired: 'This session has expired.',
  invalid_credentials: 'That email and password do not match.',
  too_many_attempts: 'Too many sign-in attempts.',
  validation: 'Some fields need attention.',
  certificate_expired: 'The certificate of insurance does not cover this.',
  cutoff: 'That date is closed for booking.',
  hold_limit: 'You already hold the most windows allowed.',
  insufficient_hours: 'Not enough pack hours for this window.',
  document_expired: "This document's expiry date has passed.",
  slot_taken: 'Someone else just claimed that window.',
  series_conflict: 'Some weeks of this series are taken.',
  rate_exists: 'A rate already starts on that date.',
  invalid_transition: 'This record is no longer in that state.',
  hold_expired: 'That hold has expired.',
  too_early: 'It is too early for that.',
  too_late: 'It is too late for that.',
  visit_open: 'This truck already has an open visit.',
  idempotency_conflict: 'That idempotency key was used for another request.',
  idempotency_in_progress: 'A request with that idempotency key is still in flight.',
  body_too_large: 'The request body is too large.',
  file_too_large: 'The file is too large.',
  unsupported_media_type: 'That content type is not accepted here.',
  unsupported_type: 'Upload a PDF, PNG or JPEG file.',
  billing_unavailable: 'Billing is unreachable right now.',
  storage_unavailable: 'Document storage is unreachable right now.',
  link_expired: 'This link has expired.',
  link_revoked: 'This link was revoked.',
  internal: 'Something went wrong.',
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields: Record<string, string> | null;
  readonly dates: string[] | null;
  readonly headers: Record<string, string>;

  constructor(
    code: ErrorCode,
    options: {
      message?: string;
      fields?: Record<string, string>;
      dates?: string[];
      headers?: Record<string, string>;
    } = {},
  ) {
    super(options.message ?? CODE_MESSAGE[code]);
    this.name = 'ApiError';
    this.code = code;
    this.status = CODE_STATUS[code];
    this.fields = options.fields ?? null;
    this.dates = options.dates ?? null;
    this.headers = options.headers ?? {};
  }

  body(): ApiErrorBody {
    const error: ApiErrorBody['error'] = { code: this.code, message: this.message };
    if (this.fields !== null) error.fields = this.fields;
    if (this.dates !== null) error.dates = this.dates;
    return { error };
  }
}

export function validationError(fields: Record<string, string>): ApiError {
  return new ApiError('validation', { fields });
}

export function unknownFieldsError(names: readonly string[]): ApiError {
  const fields: Record<string, string> = {};
  for (const name of names) fields[name] = 'Unknown field.';
  return validationError(fields);
}

export function auditOutcomeFor(status: number, code: string | null): AuditOutcome {
  if (status >= 200 && status < 300) return 'allowed';
  if (status === 401) return 'refused_session';
  if (status === 403) {
    return code === 'csrf_failed' || code === 'cross_origin' ? 'refused_csrf' : 'refused_role';
  }
  if (status === 429) return 'refused_rate';
  if (status === 405) return 'refused_role';
  if (status === 404 || status === 410) return 'refused_scope';
  if (status === 413 || status === 415 || status === 422) return 'refused_validation';
  if (status === 409) return 'refused_conflict';
  return 'failed_dependency';
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
