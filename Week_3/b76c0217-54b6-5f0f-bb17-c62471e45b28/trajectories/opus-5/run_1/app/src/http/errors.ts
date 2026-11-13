import { messages } from '../domain/messages';

/**
 * The one error shape for the whole API: {"error":{"code","message",...extra}}.
 * Error precedence is applied by the request pipeline in this order:
 *  1 body size and media type, 2 authentication, 3 unknown resource, 4 role and origin,
 *  5 idempotent replay, 6 state conflict, 7 validation, 8 service failure.
 */
export type ErrorCode =
  | 'too_large'
  | 'unsupported_media_type'
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'not_found'
  | 'forbidden_role'
  | 'cross_origin'
  | 'path_taken'
  | 'redirect_exists'
  | 'revision_conflict'
  | 'page_removed'
  | 'reference_page'
  | 'publish_blocked'
  | 'publish_in_progress'
  | 'slug_taken'
  | 'email_in_use'
  | 'invite_pending'
  | 'owner_role_fixed'
  | 'version_unpublished'
  | 'invite_invalid'
  | 'validation_failed'
  | 'redirect_loop'
  | 'redirect_off_site'
  | 'redirect_target_missing'
  | 'idempotency_key_required'
  | 'idempotency_key_reused'
  | 'invalid_openapi'
  | 'mock_unknown_code'
  | 'storage_unavailable'
  | 'mail_unavailable';

const STATUS: Readonly<Record<ErrorCode, number>> = {
  too_large: 413,
  unsupported_media_type: 415,
  unauthenticated: 401,
  invalid_credentials: 401,
  not_found: 404,
  forbidden_role: 403,
  cross_origin: 403,
  path_taken: 409,
  redirect_exists: 409,
  revision_conflict: 409,
  page_removed: 409,
  reference_page: 409,
  publish_blocked: 409,
  publish_in_progress: 409,
  slug_taken: 409,
  email_in_use: 409,
  invite_pending: 409,
  owner_role_fixed: 409,
  version_unpublished: 409,
  invite_invalid: 410,
  validation_failed: 422,
  redirect_loop: 422,
  redirect_off_site: 422,
  redirect_target_missing: 422,
  idempotency_key_required: 422,
  idempotency_key_reused: 422,
  invalid_openapi: 422,
  mock_unknown_code: 422,
  storage_unavailable: 503,
  mail_unavailable: 503,
};

const DEFAULT_MESSAGE: Readonly<Record<ErrorCode, string>> = {
  too_large: 'This request is larger than the limit.',
  unsupported_media_type: 'This media type is not supported.',
  unauthenticated: 'Sign in to continue.',
  invalid_credentials: messages.signInFailed,
  not_found: 'Not found.',
  forbidden_role: messages.noAccess,
  cross_origin: 'This request came from another origin.',
  path_taken: 'Another page already uses this path.',
  redirect_exists: 'A redirect from this path already exists.',
  revision_conflict: 'This page was saved by someone else.',
  page_removed: 'This page was removed.',
  reference_page: 'Reference pages are generated from the OpenAPI file.',
  publish_blocked: 'Publish is blocked.',
  publish_in_progress: messages.publishInProgress,
  slug_taken: 'Another version already uses this slug.',
  email_in_use: 'That email already has an account.',
  invite_pending: 'That email already has an invite.',
  owner_role_fixed: "The owner's role cannot change.",
  version_unpublished: 'Only a published version can become the default.',
  invite_invalid: messages.inviteInvalid,
  validation_failed: 'Check the highlighted fields.',
  redirect_loop: 'This would create a redirect loop.',
  redirect_off_site: messages.offSite,
  redirect_target_missing: 'No page at that path.',
  idempotency_key_required: 'An Idempotency-Key header is required.',
  idempotency_key_reused: 'That idempotency key belongs to another version.',
  invalid_openapi: messages.importInvalid,
  mock_unknown_code: 'That response code is not documented.',
  storage_unavailable: 'File storage is unavailable.',
  mail_unavailable: messages.inviteHeld,
};

export type ErrorExtra = Readonly<Record<string, unknown>>;

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly extra: ErrorExtra;

  constructor(code: ErrorCode, message?: string, extra: ErrorExtra = {}) {
    super(message ?? DEFAULT_MESSAGE[code]);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS[code];
    this.extra = extra;
  }

  body(): { error: Record<string, unknown> } {
    return { error: { code: this.code, message: this.message, ...this.extra } };
  }
}

export const apiError = (code: ErrorCode, message?: string, extra?: ErrorExtra): ApiError =>
  new ApiError(code, message, extra);

export const validationFailed = (fields: Record<string, string>): ApiError =>
  new ApiError('validation_failed', DEFAULT_MESSAGE.validation_failed, { fields });

export const notFound = (): ApiError => new ApiError('not_found');
