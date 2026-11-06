export type ErrorCode =
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'forbidden'
  | 'cross_origin'
  | 'not_in_room'
  | 'knock_required'
  | 'not_author'
  | 'not_found'
  | 'validation'
  | 'too_large'
  | 'unsupported_media_type'
  | 'email_taken'
  | 'illegal_transition'
  | 'open_sub_issues'
  | 'cycle_closed'
  | 'version_conflict'
  | 'idempotency_conflict'
  | 'room_open'
  | 'room_empty'
  | 'already_inside'
  | 'knock_expired'
  | 'knock_answered'
  | 'workspace_full'
  | 'invite_pending'
  | 'already_member'
  | 'already_in_workspace'
  | 'invite_expired'
  | 'invite_revoked'
  | 'invite_accepted'
  | 'invite_not_pending'
  | 'seats_below_active'
  | 'owner_required'
  | 'database_unavailable'
  | 'storage_unavailable'
  | 'billing_unavailable';

const statusByCode: Record<ErrorCode, number> = {
  unauthenticated: 401,
  invalid_credentials: 401,
  forbidden: 403,
  cross_origin: 403,
  not_in_room: 403,
  knock_required: 403,
  not_author: 403,
  not_found: 404,
  validation: 422,
  too_large: 413,
  unsupported_media_type: 415,
  email_taken: 409,
  illegal_transition: 409,
  open_sub_issues: 409,
  cycle_closed: 409,
  version_conflict: 412,
  idempotency_conflict: 409,
  room_open: 409,
  room_empty: 409,
  already_inside: 409,
  knock_expired: 409,
  knock_answered: 409,
  workspace_full: 409,
  invite_pending: 409,
  already_member: 409,
  already_in_workspace: 409,
  invite_expired: 409,
  invite_revoked: 409,
  invite_accepted: 409,
  invite_not_pending: 409,
  seats_below_active: 409,
  owner_required: 409,
  database_unavailable: 503,
  storage_unavailable: 503,
  billing_unavailable: 503,
};

const defaultMessages: Record<ErrorCode, string> = {
  unauthenticated: 'Sign in to continue.',
  invalid_credentials: "That email and password don't match.",
  forbidden: 'Your role does not allow this.',
  cross_origin: 'This request came from another origin.',
  not_in_room: 'You are not inside that room.',
  knock_required: 'Knock and wait to be let in.',
  not_author: 'Only the message author can attach files to it.',
  not_found: "That item doesn't exist or isn't shared with you.",
  validation: 'Check the highlighted fields.',
  too_large: 'That request body is too large.',
  unsupported_media_type: 'Send this request as JSON.',
  email_taken: 'An account with that email already exists.',
  illegal_transition: 'That status change is not allowed.',
  open_sub_issues: 'That issue has open sub-issues.',
  cycle_closed: 'That cycle has ended.',
  version_conflict: 'A newer version was saved while you were editing.',
  idempotency_conflict: 'That idempotency key was used with a different body.',
  room_open: 'That room is open, just walk in.',
  room_empty: 'That room is empty, just walk in.',
  already_inside: 'You are already inside that room.',
  knock_expired: 'That knock has expired.',
  knock_answered: 'That knock was already answered.',
  workspace_full: 'No free seats in this workspace.',
  invite_pending: 'That email already has a pending invite.',
  already_member: 'That email is already in this workspace.',
  already_in_workspace: 'You already belong to a workspace.',
  invite_expired: 'That invite has expired.',
  invite_revoked: 'That invite was withdrawn.',
  invite_accepted: 'That invite was already accepted.',
  invite_not_pending: 'That invite is not pending.',
  seats_below_active: 'That seat limit is below the active people.',
  owner_required: 'A workspace keeps its owner.',
  database_unavailable: "Tallyroom can't reach its database. Changes are not being saved.",
  storage_unavailable: 'Attachments are unavailable right now.',
  billing_unavailable: "Can't reach billing right now.",
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields: Record<string, string> | undefined;
  readonly extra: Record<string, unknown> | undefined;

  constructor(
    code: ErrorCode,
    options: {
      message?: string;
      fields?: Record<string, string>;
      extra?: Record<string, unknown>;
      status?: number;
    } = {},
  ) {
    super(options.message ?? defaultMessages[code]);
    this.code = code;
    this.status = options.status ?? statusByCode[code];
    this.fields = options.fields;
    this.extra = options.extra;
  }

  body(): Record<string, unknown> {
    const error: Record<string, unknown> = { code: this.code, message: this.message };
    if (this.fields !== undefined) error.fields = this.fields;
    return { error, ...(this.extra ?? {}) };
  }
}
