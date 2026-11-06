// The single error shape, with the published codes, and the error precedence
// helpers used by every route.

export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;
  readonly headers?: Record<string, string>;

  constructor(status: number, code: string, message: string, options?: { fields?: Record<string, string>; headers?: Record<string, string> }) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = options?.fields;
    this.headers = options?.headers;
  }

  body(): ApiErrorBody {
    const body: ApiErrorBody = { error: this.code, message: this.message };
    if (this.fields) body.fields = this.fields;
    return body;
  }
}

export const errors = {
  crossSite: () => new ApiError(403, 'cross_site_request', 'Cross-site requests are refused.'),
  payloadTooLarge: () => new ApiError(413, 'payload_too_large', 'The request body is too large.'),
  fileTooLarge: () => new ApiError(413, 'file_too_large', 'This file is too large.'),
  unsupportedMediaType: () => new ApiError(415, 'unsupported_media_type', 'Send the request as JSON.'),
  unauthenticated: () => new ApiError(401, 'unauthenticated', 'Sign in first.'),
  sessionExpired: () => new ApiError(401, 'session_expired', 'Your session ended. Sign in again.'),
  csrfInvalid: () => new ApiError(403, 'csrf_token_invalid', 'The request token is not valid.'),
  notFound: () => new ApiError(404, 'not_found', "We couldn't find that."),
  forbidden: () => new ApiError(403, 'forbidden', 'You do not have permission to do that.'),
  signinLocked: (retryAfter: number) => new ApiError(429, 'signin_locked', 'Too many sign-in attempts. Try again later.', { headers: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfter))) } }),
  invalidCredentials: () => new ApiError(401, 'invalid_credentials', 'Email or password is incorrect.'),
  validation: (fields: Record<string, string>) => new ApiError(422, 'validation', 'Check the highlighted fields.', { fields }),
  versionConflict: () => new ApiError(409, 'version_conflict', 'Someone else saved this page.'),
  danglingConnector: (fields: Record<string, string>) => new ApiError(422, 'dangling_connector', 'A connector must start and end on its shapes\' ports.', { fields }),
  pageLimit: () => new ApiError(409, 'page_limit', 'This diagram already has the maximum number of pages.'),
  alreadyMember: () => new ApiError(409, 'already_member', 'This person already has access.'),
  invitePending: () => new ApiError(409, 'invite_pending', 'An invitation to this email is already pending.'),
  sharePending: () => new ApiError(409, 'share_pending', 'This invitation is still pending.'),
  shareEnded: () => new ApiError(409, 'share_ended', 'This share has ended.'),
  inviteRateLimited: (retryAfter: number) => new ApiError(429, 'invite_rate_limited', 'Too many invitations sent. Try again later.', { headers: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfter))) } }),
  inviteLookupLimited: (retryAfter: number) => new ApiError(429, 'invite_lookup_limited', 'Wait a few minutes and open the link again.', { headers: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfter))) } }),
  inviteExpired: () => new ApiError(410, 'invite_expired', 'This invitation has expired.'),
  inviteEmailMismatch: () => new ApiError(403, 'invite_email_mismatch', 'This invitation was sent to a different email address.'),
  inviteUsed: () => new ApiError(404, 'not_found', "We couldn't find that."),
  idempotencyInProgress: () => new ApiError(409, 'idempotency_in_progress', 'An export with this key is already running.'),
  exportNotReady: () => new ApiError(409, 'export_not_ready', 'This export is not ready.'),
  storageUnavailable: () => new ApiError(503, 'storage_unavailable', 'File storage is unavailable.'),
  unsupportedFileType: () => new ApiError(415, 'unsupported_file_type', 'Only diagram XML and SVG files can be imported.'),
  invalidModel: () => new ApiError(422, 'invalid_model', 'This file does not describe a valid diagram.'),
  unsafeFile: () => new ApiError(422, 'unsafe_file', 'This file contains scripts, external entities or unsafe links.'),
  linkExpired: () => new ApiError(410, 'link_expired', 'This download link has expired.'),
  methodNotAllowed: () => new ApiError(405, 'method_not_allowed', 'This method is not allowed.', { headers: { Allow: 'GET' } }),
  internal: () => new ApiError(500, 'internal', 'Something went wrong.'),
} as const;
