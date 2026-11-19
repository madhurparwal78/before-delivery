import { formatStamp } from '../shared/format.js';
import type { FieldErrors } from '../shared/recipe.js';

/** The one error shape every API failure uses. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | null;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> | null = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  body(): Record<string, unknown> {
    const error: Record<string, unknown> = { code: this.code, message: this.message };
    const body: Record<string, unknown> = { error };
    if (this.details !== null) body['details'] = this.details;
    return body;
  }
}

export const apiErrors = {
  unauthenticated: (): ApiError => new ApiError(401, 'unauthenticated', 'Sign in first.'),
  notFound: (): ApiError => new ApiError(404, 'not_found', 'Not found.'),
  ownerOnly: (): ApiError => new ApiError(403, 'forbidden', 'Only the team owner can do this.'),
  crossOrigin: (): ApiError => new ApiError(403, 'forbidden', 'Only same-origin requests are allowed.'),
  payloadTooLarge: (limit: number): ApiError =>
    new ApiError(413, 'payload_too_large', `The request body is larger than ${limit} bytes.`),
  validation: (fields: FieldErrors): ApiError =>
    new ApiError(422, 'validation_failed', 'Some fields need attention.', { fields }),
  emailTaken: (): ApiError => new ApiError(409, 'email_taken', 'An account with this email already exists.'),
  invalidCredentials: (): ApiError => new ApiError(401, 'invalid_credentials', 'Email or password is wrong.'),
  emailUnverified: (): ApiError =>
    new ApiError(403, 'email_unverified', 'Confirm your email first. We sent you a link.'),
  versionConflict: (latestVersion: number, authorName: string): ApiError =>
    new ApiError(
      409,
      'version_conflict',
      `Version ${latestVersion} was saved by ${authorName} while you were editing.`,
      { latestVersion, authorName },
    ),
  searchUnavailable: (): ApiError =>
    new ApiError(503, 'search_unavailable', 'Search is unavailable. Showing recent recipes.'),
  storageUnavailable: (): ApiError =>
    new ApiError(503, 'storage_unavailable', 'Storage is unavailable. The file was not saved.'),
  mailUnavailable: (): ApiError => new ApiError(503, 'mail_unavailable', 'Email could not be sent. Try again.'),
  fileTooLarge: (size: number, limit: number): ApiError =>
    new ApiError(413, 'file_too_large', `File too large: ${size} bytes (limit ${limit} bytes).`),
  snapshotPending: (): ApiError =>
    new ApiError(409, 'snapshot_pending', 'This snapshot is waiting for storage to confirm its input.'),
  snapshotExpired: (expiresAt: string): ApiError =>
    new ApiError(409, 'snapshot_expired', `This snapshot expired on ${formatStamp(expiresAt)}.`),
  snapshotRevoked: (): ApiError => new ApiError(409, 'snapshot_revoked', 'This snapshot was revoked.'),
  teamFull: (max: number): ApiError => new ApiError(409, 'team_full', `This team is full (${max} of ${max}).`),
  alreadyMember: (email: string): ApiError =>
    new ApiError(409, 'already_member', `${email} is already in this team.`),
  inviteWrongAccount: (email: string): ApiError =>
    new ApiError(403, 'invite_wrong_account', `This invite was sent to ${email}.`),
  cannotRemoveOwner: (): ApiError => new ApiError(409, 'cannot_remove_owner', 'The owner cannot be removed.'),
  importUnmatched: (lines: string[]): ApiError =>
    new ApiError(
      422,
      'import_unmatched',
      `${lines.length} ${lines.length === 1 ? 'line' : 'lines'} did not match. Nothing was created.`,
      { lines },
    ),
  liveUnavailable: (): ApiError => new ApiError(503, 'live_unavailable', 'Live updates are unavailable.'),
};
