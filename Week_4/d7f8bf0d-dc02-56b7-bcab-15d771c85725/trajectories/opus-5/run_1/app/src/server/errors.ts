import type { ApiErrorBody, Finding } from '../shared/protocol.js';

export type ErrorExtra = Omit<ApiErrorBody, 'error'>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: ErrorExtra;

  constructor(status: number, code: string, message: string, extra: ErrorExtra = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  body(): ApiErrorBody {
    return { error: { code: this.code, message: this.message }, ...this.extra };
  }
}

/** The order of these definitions is the published order of checks. */
export const errors = {
  badJson: (): ApiError => new ApiError(400, 'bad_json', 'That request could not be read.'),
  bodyTooLarge: (): ApiError => new ApiError(413, 'body_too_large', 'That request is too large.'),
  badContentType: (): ApiError => new ApiError(415, 'bad_content_type', 'Send JSON.'),
  instancesRestarting: (): ApiError =>
    new ApiError(503, 'instances_restarting', 'Gandyboard is restarting. Try again in a moment.'),

  sessionRequired: (): ApiError =>
    new ApiError(401, 'session_required', 'Your sign-in has ended. Sign in to carry on.'),
  forbidden: (): ApiError => new ApiError(403, 'forbidden', 'You do not have access to this.'),
  notFound: (): ApiError => new ApiError(404, 'not_found', 'That item is not in this workspace.'),
  idempotencyKeyRequired: (): ApiError =>
    new ApiError(422, 'idempotency_key_required', 'This request needs a key.'),
  idempotencyKeyReused: (): ApiError =>
    new ApiError(422, 'idempotency_key_reused', 'This key was already used with different details.'),
  staleRevision: (): ApiError =>
    new ApiError(409, 'stale_revision', 'Someone changed this first. Review the latest and try again.'),
  valkeyUnavailable: (): ApiError =>
    new ApiError(
      503,
      'valkey_unavailable',
      'Live updates are paused. Sessions are held at their last committed tick.',
    ),
  invalidFields: (): ApiError =>
    new ApiError(422, 'invalid_fields', 'Check the details and try again.'),

  invalidCredentials: (): ApiError =>
    new ApiError(401, 'invalid_credentials', 'That email and password do not match.'),
  memberExists: (): ApiError =>
    new ApiError(422, 'member_exists', 'That person is already a member.'),
  openEndTaken: (label: string, displayName: string, pieceId: string): ApiError =>
    new ApiError(
      409,
      'open_end_taken',
      `Open end ${label} was just extended by ${displayName}. Nothing was changed.`,
      { piece_id: pieceId },
    ),
  pieceRules: (findings: Finding[]): ApiError =>
    new ApiError(422, 'validation_failed', 'This piece breaks the club standard.', { findings }),
  versionRules: (findings: Finding[]): ApiError =>
    new ApiError(422, 'validation_failed', 'This version breaks the club standard.', { findings }),
  pieceHasFollowers: (): ApiError =>
    new ApiError(422, 'piece_has_followers', 'Remove the pieces after this one first.'),
  versionTransition: (state: string): ApiError =>
    new ApiError(422, 'version_transition', `A ${state} version cannot do that.`),
  versionNotPublished: (): ApiError =>
    new ApiError(422, 'version_not_published', 'Only a Published version can run a session.'),
  sessionTransition: (status: string): ApiError =>
    new ApiError(422, 'session_transition', `A ${status} session cannot do that.`),
  sessionNotActive: (): ApiError =>
    new ApiError(422, 'session_not_active', 'This session is not running.'),
  blockInUse: (blockName: string): ApiError =>
    new ApiError(422, 'block_in_use', `${blockName} is in use.`),
  routeConflictHeld: (otherNumber: string, blockName: string, extra: ErrorExtra): ApiError =>
    new ApiError(422, 'route_conflict', `Train ${otherNumber} holds ${blockName}.`, extra),
  routeConflictOutOfService: (blockName: string, extra: ErrorExtra): ApiError =>
    new ApiError(422, 'route_conflict', `${blockName} is out of service.`, extra),
  noRoute: (blockName: string): ApiError =>
    new ApiError(422, 'no_route', `There is no road from here to ${blockName}.`),
  routeTooLong: (): ApiError =>
    new ApiError(
      422,
      'route_too_long',
      'That road is more than 8 blocks. Choose a nearer destination.',
    ),
  authorityActive: (trainNumber: string): ApiError =>
    new ApiError(422, 'authority_active', `Train ${trainNumber} already has the road.`),
  approachLocked: (trainNumber: string): ApiError =>
    new ApiError(
      422,
      'approach_locked',
      `Train ${trainNumber} is on the approach. The authority cannot be cancelled.`,
    ),
  authorityEnded: (): ApiError =>
    new ApiError(422, 'authority_ended', 'That authority has already ended.'),
  deadlockOpen: (numbers: string[]): ApiError =>
    new ApiError(
      422,
      'deadlock_open',
      `Trains ${numbers.join(', ')} are deadlocked. Use Back to loop or Recall.`,
    ),
  noFreeLoop: (trainNumber: string): ApiError =>
    new ApiError(422, 'no_free_loop', `No loop is free for Train ${trainNumber}.`),
  recallBlocked: (blockName: string): ApiError =>
    new ApiError(422, 'recall_blocked', `${blockName} is not free.`),
  turnoutLocked: (turnoutId: string, trainNumber: string): ApiError =>
    new ApiError(422, 'turnout_locked', `Turnout ${turnoutId} is locked by Train ${trainNumber}.`),
  packetNoPdf: (): ApiError => new ApiError(422, 'packet_no_pdf', 'This packet has no PDF.'),
} as const;
