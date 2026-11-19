import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Role } from '../shared/domain';

export type ErrorCode =
  | 'session_required'
  | 'forbidden'
  | 'not_found'
  | 'idempotency_key_required'
  | 'idempotency_key_reused'
  | 'stale_revision'
  | 'valkey_unavailable'
  | 'invalid_fields'
  | 'invalid_credentials'
  | 'member_exists'
  | 'open_end_taken'
  | 'validation_failed'
  | 'version_transition'
  | 'version_not_published'
  | 'session_transition'
  | 'session_not_active'
  | 'block_in_use'
  | 'turnout_locked'
  | 'route_conflict'
  | 'no_route'
  | 'route_too_long'
  | 'authority_active'
  | 'authority_ended'
  | 'approach_locked'
  | 'deadlock_open'
  | 'no_free_loop'
  | 'recall_blocked'
  | 'packet_no_pdf'
  | 'piece_has_followers'
  | 'body_too_large'
  | 'bad_json'
  | 'bad_content_type'
  | 'instances_restarting';

export const ERROR_COPY: Record<ErrorCode, string> = {
  session_required: 'Your sign-in has ended. Sign in to carry on.',
  forbidden: 'You do not have access to this.',
  not_found: 'That item is not in this workspace.',
  idempotency_key_required: 'This request needs a key.',
  idempotency_key_reused: 'This key was already used with different details.',
  stale_revision: 'Someone changed this first. Review the latest and try again.',
  valkey_unavailable: 'Live updates are paused. Sessions are held at their last committed tick.',
  invalid_fields: 'Check the details and try again.',
  invalid_credentials: 'That email and password do not match.',
  member_exists: 'That person is already a member.',
  open_end_taken: 'Open end <label> was just extended by <display name>. Nothing was changed.',
  validation_failed: 'This piece breaks the club standard.',
  version_transition: 'A <state> version cannot do that.',
  version_not_published: 'Only a Published version can run a session.',
  session_transition: 'A <status> session cannot do that.',
  session_not_active: 'This session is not running.',
  block_in_use: '<block> is in use.',
  turnout_locked: 'Turnout <id> is locked by Train <number>.',
  route_conflict: 'Train <other> holds <block>.',
  no_route: 'There is no road from here to <block>.',
  route_too_long: 'That road is more than 8 blocks. Choose a nearer destination.',
  authority_active: 'Train <number> already has the road.',
  authority_ended: 'That authority has already ended.',
  approach_locked: 'Train <number> is on the approach. The authority cannot be cancelled.',
  deadlock_open: 'Trains <numbers> are deadlocked. Use Back to loop or Recall.',
  no_free_loop: 'No loop is free for Train <number>.',
  recall_blocked: '<block> is not free.',
  packet_no_pdf: 'This packet has no PDF.',
  piece_has_followers: 'Remove the pieces after this one first.',
  body_too_large: 'That request is too large.',
  bad_json: 'That request could not be read.',
  bad_content_type: 'Send JSON.',
  instances_restarting: 'Gandyboard is restarting. Try again in a moment.',
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: ErrorCode, message?: string, extra: Record<string, unknown> = {}) {
    super(message ?? ERROR_COPY[code]);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

const e = {
  sessionRequired: () => new ApiError(401, 'session_required'),
  forbidden: () => new ApiError(403, 'forbidden'),
  notFound: () => new ApiError(404, 'not_found'),
  idempotencyKeyRequired: () => new ApiError(422, 'idempotency_key_required'),
  idempotencyKeyReused: () => new ApiError(422, 'idempotency_key_reused'),
  staleRevision: () => new ApiError(409, 'stale_revision'),
  valkeyUnavailable: () => new ApiError(503, 'valkey_unavailable'),
  invalidFields: (extra: Record<string, unknown> = {}) => new ApiError(422, 'invalid_fields', ERROR_COPY.invalid_fields, extra),
  invalidCredentials: () => new ApiError(401, 'invalid_credentials'),
  memberExists: () => new ApiError(422, 'member_exists'),
  openEndTaken: (label: string, displayName: string, pieceId: string) =>
    new ApiError(409, 'open_end_taken', `Open end ${label} was just extended by ${displayName}. Nothing was changed.`, { piece_id: pieceId }),
  validationFailed: (findings: unknown[], message = ERROR_COPY.validation_failed) =>
    new ApiError(422, 'validation_failed', message, { findings }),
  validationFailedLayout: (findings: unknown[]) =>
    new ApiError(422, 'validation_failed', 'This version breaks the club standard.', { findings }),
  versionTransition: (state: string) => new ApiError(422, 'version_transition', `A ${state} version cannot do that.`),
  versionNotPublished: () => new ApiError(422, 'version_not_published'),
  sessionTransition: (status: string) => new ApiError(422, 'session_transition', `A ${status} session cannot do that.`),
  sessionNotActive: () => new ApiError(422, 'session_not_active'),
  blockInUse: (block: string) => new ApiError(422, 'block_in_use', `${block} is in use.`),
  turnoutLocked: (id: string, number: string) => new ApiError(422, 'turnout_locked', `Turnout ${id} is locked by Train ${number}.`),
  routeConflict: (other: string | null, block: string, authority: unknown, conflict: unknown, reachable: string[]) =>
    new ApiError(422, 'route_conflict', other ? `Train ${other} holds ${block}.` : `${block} is out of service.`, {
      authority,
      conflict,
      reachable_block_ids: reachable,
    }),
  noRoute: (block: string) => new ApiError(422, 'no_route', `There is no road from here to ${block}.`),
  routeTooLong: () => new ApiError(422, 'route_too_long'),
  authorityActive: (number: string) => new ApiError(422, 'authority_active', `Train ${number} already has the road.`),
  authorityEnded: () => new ApiError(422, 'authority_ended'),
  approachLocked: (number: string) => new ApiError(422, 'approach_locked', `Train ${number} is on the approach. The authority cannot be cancelled.`),
  deadlockOpen: (numbers: string[]) => new ApiError(422, 'deadlock_open', `Trains ${numbers.join(', ')} are deadlocked. Use Back to loop or Recall.`),
  noFreeLoop: (number: string) => new ApiError(422, 'no_free_loop', `No loop is free for Train ${number}.`),
  recallBlocked: (block: string) => new ApiError(422, 'recall_blocked', `${block} is not free.`),
  packetNoPdf: () => new ApiError(422, 'packet_no_pdf'),
  bodyTooLarge: () => new ApiError(413, 'body_too_large'),
  badJson: () => new ApiError(400, 'bad_json'),
  badContentType: () => new ApiError(415, 'bad_content_type'),
  instancesRestarting: () => new ApiError(503, 'instances_restarting'),
};

export const errors = e;

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  rawBody: string;
  userId: string | null;
  user: { id: string; email: string; display_name: string; walkthrough_done: boolean } | null;
  workspaceId: string | null;
  role: Role | null;
  idempotencyKey: string | null;
  params: Record<string, string>;
}
