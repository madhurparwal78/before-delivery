import { fieldCopy } from '../shared/copy.js';
import type { ApiError } from '../shared/api.js';

/** The one error shape, built in one place. */
export class Fault extends Error {
  readonly status: number;

  readonly code: string;

  readonly fields?: Record<string, string>;

  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    extra: { fields?: Record<string, string>; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.status = status;
    this.code = code;
    if (extra.fields) this.fields = extra.fields;
    if (extra.details) this.details = extra.details;
  }

  body(): ApiError {
    const error: ApiError['error'] = { code: this.code, message: this.message };
    if (this.fields) error.fields = this.fields;
    if (this.details) error.details = this.details;
    return { error };
  }
}

export const faults = {
  readOnly: (): Fault =>
    new Fault(405, 'read_only', 'This link is read-only.'),
  payloadTooLarge: (message: string): Fault => new Fault(413, 'payload_too_large', message),
  unsupportedMediaType: (): Fault =>
    new Fault(415, 'unsupported_media_type', 'Send this request as JSON.'),
  crossOrigin: (): Fault =>
    new Fault(403, 'cross_origin', 'This request came from another origin.'),
  unauthenticated: (): Fault => new Fault(401, 'unauthenticated', 'Sign in to continue.'),
  badCredentials: (): Fault => new Fault(401, 'bad_credentials', fieldCopy.signInFailed),
  notFound: (): Fault => new Fault(404, 'not_found', 'We could not find that.'),
  linkNotFound: (): Fault => new Fault(404, 'link_not_found', 'This link no longer works.'),
  forbidden: (): Fault =>
    new Fault(403, 'forbidden', 'Your role in this workspace cannot do that.'),
  inviteEmailMismatch: (email: string): Fault =>
    new Fault(403, 'invite_email_mismatch', `This invite is for ${email}.`),
  changeIdReused: (): Fault =>
    new Fault(409, 'change_id_reused', 'This change id was already used for a different change.'),
  lockStoreUnavailable: (): Fault =>
    new Fault(503, 'lock_store_unavailable', 'The lock service is unreachable.'),
  storageUnavailable: (): Fault =>
    new Fault(503, 'storage_unavailable', 'File storage is unreachable.'),
  validation: (fields: Record<string, string>): Fault =>
    new Fault(422, 'validation', 'Check the highlighted values.', { fields }),
  invalidCursor: (): Fault => new Fault(422, 'invalid_cursor', 'That activity cursor is not valid.'),
  emailTaken: (): Fault =>
    new Fault(409, 'email_taken', 'An account already uses this email.', {
      fields: { email: fieldCopy.emailTaken },
    }),
  checkpointNameTaken: (): Fault =>
    new Fault(409, 'checkpoint_name_taken', 'A checkpoint with this name already exists.', {
      fields: { label: fieldCopy.checkpointNameTaken },
    }),
  alreadyMember: (): Fault =>
    new Fault(409, 'already_member', 'That person is already a member of this workspace.'),
  ownerRoleFixed: (): Fault => new Fault(409, 'owner_role_fixed', "The owner's role cannot change."),
  inviteUsed: (): Fault => new Fault(409, 'invite_used', 'This invite has already been used.'),
  inviteSuperseded: (): Fault =>
    new Fault(410, 'invite_superseded', 'This invite was replaced by a newer one.'),
  inviteRevoked: (): Fault => new Fault(410, 'invite_revoked', 'This invite was withdrawn.'),
  inviteExpired: (): Fault => new Fault(410, 'invite_expired', 'This invite has expired.'),
  staleLock: (objectId: string): Fault =>
    new Fault(409, 'stale_lock', 'Your hold on that object is no longer current.', {
      details: { objectId },
    }),
  lockHeld: (holder: { userId: string; displayName: string }, expiresAt: string): Fault =>
    new Fault(409, 'lock_held', `${holder.displayName} is editing that object.`, {
      details: { holder, expiresAt },
    }),
  revisionConflict: (currentRevision: number, conflicts: string[]): Fault =>
    new Fault(412, 'revision_conflict', 'This scene changed elsewhere.', {
      details: { currentRevision, conflicts },
    }),
  locksHeld: (holders: { userId: string; displayName: string }[]): Fault =>
    new Fault(409, 'locks_held', 'Others are editing objects in this scene.', {
      details: { holders },
    }),
  noCheckpoint: (): Fault => new Fault(409, 'no_checkpoint', 'Save a checkpoint before publishing.'),
  notPublished: (): Fault => new Fault(409, 'not_published', 'This scene is not published.'),
};
