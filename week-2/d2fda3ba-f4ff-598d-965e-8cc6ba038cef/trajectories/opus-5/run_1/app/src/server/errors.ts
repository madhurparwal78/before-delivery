import type { FieldErrors } from '../shared/validation';

export type ErrorCode =
  | 'unsupported_media_type'
  | 'payload_too_large'
  | 'cross_origin'
  | 'unauthenticated'
  | 'not_found'
  | 'method_not_allowed'
  | 'idempotency_key_reused'
  | 'email_taken'
  | 'invalid_credentials'
  | 'device_not_approved'
  | 'not_vault_owner'
  | 'invite_email_mismatch'
  | 'vault_read_only'
  | 'not_operator'
  | 'sync_not_entitled'
  | 'publish_not_entitled'
  | 'link_used'
  | 'link_expired'
  | 'revision_conflict'
  | 'already_subscribed'
  | 'not_subscribed'
  | 'slug_taken'
  | 'invalid_transition'
  | 'publish_in_progress'
  | 'preview_link_inactive'
  | 'sweep_running'
  | 'validation_failed'
  | 'storage_unavailable'
  | 'billing_unavailable'
  | 'internal_error';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: ErrorCode, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  body(): Record<string, unknown> {
    return { error: { code: this.code, message: this.message, ...this.extra } };
  }
}

export function validationFailed(fields: FieldErrors): ApiError {
  return new ApiError(422, 'validation_failed', 'Some fields need attention.', { fields });
}

export function notFound(): ApiError {
  return new ApiError(404, 'not_found', 'Not found.');
}

export function unauthenticated(): ApiError {
  return new ApiError(401, 'unauthenticated', 'Sign in to continue.');
}

export function storageUnavailable(): ApiError {
  return new ApiError(503, 'storage_unavailable', 'Object storage is unavailable.');
}

export function billingUnavailable(): ApiError {
  return new ApiError(503, 'billing_unavailable', 'Billing is unavailable.');
}
