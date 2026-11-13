import { Response } from 'express';

export type ErrorCode =
  | 'too_large' | 'unsupported_media_type' | 'unauthenticated' | 'invalid_credentials'
  | 'not_found' | 'forbidden_role' | 'cross_origin' | 'path_taken' | 'redirect_exists'
  | 'revision_conflict' | 'page_removed' | 'reference_page' | 'publish_blocked'
  | 'publish_in_progress' | 'slug_taken' | 'email_in_use' | 'invite_pending'
  | 'owner_role_fixed' | 'version_unpublished' | 'invite_invalid' | 'validation_failed'
  | 'redirect_loop' | 'redirect_off_site' | 'redirect_target_missing'
  | 'idempotency_key_required' | 'idempotency_key_reused' | 'invalid_openapi'
  | 'mock_unknown_code' | 'storage_unavailable' | 'mail_unavailable';

const STATUS: Record<ErrorCode, number> = {
  too_large: 413, unsupported_media_type: 415, unauthenticated: 401, invalid_credentials: 401,
  not_found: 404, forbidden_role: 403, cross_origin: 403, path_taken: 409, redirect_exists: 409,
  revision_conflict: 409, page_removed: 409, reference_page: 409, publish_blocked: 409,
  publish_in_progress: 409, slug_taken: 409, email_in_use: 409, invite_pending: 409,
  owner_role_fixed: 409, version_unpublished: 409, invite_invalid: 410, validation_failed: 422,
  redirect_loop: 422, redirect_off_site: 422, redirect_target_missing: 422,
  idempotency_key_required: 422, idempotency_key_reused: 422, invalid_openapi: 422,
  mock_unknown_code: 422, storage_unavailable: 503, mail_unavailable: 503,
};

export type ApiErrorBody = {
  error: { code: ErrorCode; message: string; fields?: Record<string, string>; [key: string]: unknown };
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly extra: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.status = STATUS[code];
    this.extra = extra;
  }

  body(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, ...this.extra } };
  }
}

export const notFoundError = () => new ApiError('not_found', 'Not found.');
export const unauthenticatedError = () => new ApiError('unauthenticated', 'Sign in required.');

export function sendError(res: Response, err: unknown): void {
  if (err instanceof ApiError) {
    res.status(err.status).json(err.body());
    return;
  }
  console.error('unhandled error:', err instanceof Error ? err.stack : err);
  res.status(500).json({ error: { code: 'not_found', message: 'Unexpected error.' } });
}

export const badPathMessage = 'Paths use letters, digits, hyphens and underscores, separated by /.';

export function badPathField(field: string): ApiError {
  return new ApiError('validation_failed', 'Validation failed.', {
    fields: { [field]: badPathMessage },
  });
}
