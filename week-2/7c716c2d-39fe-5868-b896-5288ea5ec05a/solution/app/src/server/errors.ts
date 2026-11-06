// The one error shape and code table of the API (brief: Error codes).

const STATUS = {
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
} as const;

type ErrorCode = keyof typeof STATUS;

const MESSAGES: Record<ErrorCode, string> = {
  unauthenticated: "Sign in to continue.",
  invalid_credentials: "That email and password don't match.",
  forbidden: "You can't do that in this workspace.",
  cross_origin: "Requests must come from this site.",
  not_in_room: "You are not inside that room.",
  knock_required: "Knock first; someone inside has to let you in.",
  not_author: "Only the author can attach files to a message.",
  not_found: "That item doesn't exist or isn't shared with you.",
  validation: "Some fields need attention.",
  too_large: "The request is too large.",
  unsupported_media_type: "Send this request as JSON.",
  email_taken: "An account with that email already exists.",
  illegal_transition: "That status change is not allowed.",
  open_sub_issues: "Finish or cancel the open sub-issues first.",
  cycle_closed: "That cycle has ended.",
  version_conflict: "A newer version was saved.",
  idempotency_conflict: "That idempotency key was used for a different request.",
  room_open: "That room is open; join it directly.",
  room_empty: "Nobody is inside; join it directly.",
  already_inside: "You are already inside.",
  knock_expired: "That knock has expired.",
  knock_answered: "That knock was already answered.",
  workspace_full: "No free seats.",
  invite_pending: "That email already has a pending invite.",
  already_member: "That email belongs to someone in this workspace.",
  already_in_workspace: "You already belong to a workspace.",
  invite_expired: "This invite has expired.",
  invite_revoked: "This invite was withdrawn.",
  invite_accepted: "This invite was already accepted.",
  invite_not_pending: "Only pending invites can be revoked.",
  seats_below_active: "The seat limit can't go below the active people.",
  owner_required: "The owner can't remove themself.",
  database_unavailable: "Tallyroom can't reach its database.",
  storage_unavailable: "Attachment storage is unavailable.",
  billing_unavailable: "Billing is unavailable.",
};

export class ApiError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    readonly fields: Record<string, string> | null = null,
    readonly extra: Record<string, unknown> | null = null,
    status: number = STATUS[code],
  ) {
    super(MESSAGES[code]);
    this.status = status;
  }

  body(): Record<string, unknown> {
    const error: Record<string, unknown> = { code: this.code, message: this.message };
    if (this.fields) error.fields = this.fields;
    return { error, ...this.extra };
  }
}

export function invalid(fields: Record<string, string>): ApiError {
  return new ApiError("validation", fields);
}
