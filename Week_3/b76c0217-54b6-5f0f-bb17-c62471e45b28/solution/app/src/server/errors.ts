import { copy } from '../shared/copy';
import type { ApiErrorBody, PublishReport, UserRef } from '../shared/types';

type ErrorCode =
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
  | 'mail_unavailable'
  | 'internal_error';

const statuses: Record<ErrorCode, number> = {
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
  internal_error: 500,
};

type Extras = Omit<ApiErrorBody['error'], 'code' | 'message'>;

/** The one error type: every refusal the API sends is one of these, rendered by the one error shape. */
export class ApiError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly extras: Extras = {},
  ) {
    super(message);
    this.status = statuses[code];
  }

  body(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, ...this.extras } };
  }
}

export const fail = {
  tooLarge: (message: string) => new ApiError('too_large', message),
  mediaType: (message: string) => new ApiError('unsupported_media_type', message),
  unauthenticated: () => new ApiError('unauthenticated', 'Sign in to continue.'),
  invalidCredentials: () => new ApiError('invalid_credentials', copy.signInFailed),
  notFound: () => new ApiError('not_found', 'Not found.'),
  forbiddenRole: () => new ApiError('forbidden_role', copy.noAccess),
  crossOrigin: () => new ApiError('cross_origin', 'Cross-origin requests are refused.'),
  pathTaken: (path: string) => new ApiError('path_taken', copy.pathTaken(path)),
  redirectExists: (path: string) => new ApiError('redirect_exists', copy.redirectExists(path)),
  revisionConflict: (savedBy: UserRef) =>
    new ApiError('revision_conflict', copy.conflict(savedBy.name), { savedBy }),
  pageRemoved: () => new ApiError('page_removed', 'This page was removed.'),
  referencePage: () => new ApiError('reference_page', 'Reference pages are generated from the OpenAPI file.'),
  publishBlocked: (report: PublishReport) =>
    new ApiError('publish_blocked', copy.blockedHeading(report.errors.length), { report }),
  publishInProgress: () => new ApiError('publish_in_progress', copy.publishInProgress),
  slugTaken: () => new ApiError('slug_taken', 'That slug is already used.', { fields: { slug: 'That slug is already used.' } }),
  emailInUse: () => new ApiError('email_in_use', 'That email already has an account.', { fields: { email: 'That email already has an account.' } }),
  invitePending: () => new ApiError('invite_pending', 'That email already has a pending invite.', { fields: { email: 'That email already has a pending invite.' } }),
  ownerRoleFixed: () => new ApiError('owner_role_fixed', "The owner's role cannot change."),
  versionUnpublished: () => new ApiError('version_unpublished', 'Publish this version before making it the default.'),
  inviteInvalid: () => new ApiError('invite_invalid', copy.inviteInvalid),
  validation: (fields: Record<string, string>) =>
    new ApiError('validation_failed', Object.values(fields)[0] ?? 'The request is not valid.', { fields }),
  redirectLoop: (cycle: string[]) => new ApiError('redirect_loop', copy.redirectLoop(cycle), { cycle }),
  redirectOffSite: () => new ApiError('redirect_off_site', copy.offSite),
  redirectTargetMissing: (path: string) => new ApiError('redirect_target_missing', copy.targetMissing(path)),
  keyRequired: () => new ApiError('idempotency_key_required', 'Send an Idempotency-Key header of 1 to 100 characters.'),
  keyReused: () => new ApiError('idempotency_key_reused', 'That Idempotency-Key was used for another version.'),
  invalidOpenapi: () => new ApiError('invalid_openapi', copy.importInvalid),
  mockUnknownCode: () => new ApiError('mock_unknown_code', 'That response code is not documented for this operation.'),
  storageUnavailable: (message: string, report?: PublishReport) =>
    new ApiError('storage_unavailable', message, report ? { report } : {}),
  mailUnavailable: () => new ApiError('mail_unavailable', copy.stillUnavailable),
};
