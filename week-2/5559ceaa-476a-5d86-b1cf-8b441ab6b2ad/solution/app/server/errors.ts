const catalogue = {
  unauthenticated: [401, "Sign in to continue."],
  not_found: [404, "Nothing was found at this address."],
  link_not_found: [404, "This link doesn't exist."],
  forbidden: [403, "Your role in this project doesn't allow this."],
  cross_origin: [403, "Requests from other sites are refused."],
  not_driver: [403, "Only the driver may change files during a live session."],
  method_not_allowed: [405, "Only GET is allowed here."],
  idempotency_conflict: [409, "This idempotency key was already used with a different request."],
  illegal_transition: [409, "That change isn't possible from the current state."],
  session_already_live: [409, "Another session in this project is already running."],
  session_not_live: [409, "The baton is only passed during a live session."],
  session_paused: [409, "Nobody can change files while the session is paused."],
  session_in_progress: [409, "Imports are applied between sessions."],
  already_driving: [409, "That person is already driving."],
  baton_taken: [409, "Someone else took the baton first."],
  seat_taken: [409, "This one-to-one project already has a learner."],
  group_full: [409, "This group already has six learners."],
  path_taken: [409, "A file already exists at that path."],
  checkpoint_not_saved: [409, "This checkpoint hasn't finished uploading."],
  checkpoint_damaged: [409, "This checkpoint's stored files don't match its record."],
  restore_superseded: [409, "Files changed after this restore, so it can't be undone."],
  restore_already_undone: [409, "This restore was already undone."],
  import_already_applied: [409, "This import was already applied."],
  import_plan_stale: [409, "Files changed since this zip was checked."],
  import_plan_expired: [410, "This zip check has expired."],
  link_used: [410, "This sign-in link has already been used."],
  link_expired: [410, "This link has expired."],
  link_revoked: [410, "This link was revoked."],
  stale_revision: [412, "A newer revision of this file exists."],
  too_large: [413, "The request body is too large."],
  unsupported_media_type: [415, "This content type isn't accepted here."],
  validation: [422, "Some fields are invalid."],
  import_rejected: [422, "The zip failed a safety rule."],
  storage_unavailable: [503, "Storage is unreachable right now."],
  mail_unavailable: [503, "Email can't be sent right now."],
} as const;

type ErrorCode = keyof typeof catalogue;
type ErrorExtra = Record<string, unknown>;

export class ApiError extends Error {
  readonly status: number;

  constructor(readonly code: ErrorCode, readonly extra: ErrorExtra = {}) {
    super(catalogue[code][1]);
    this.status = catalogue[code][0];
  }

  body(): { error: Record<string, unknown> } {
    return { error: { code: this.code, message: this.message, ...this.extra } };
  }
}

export function invalid(fields: Record<string, string>): ApiError {
  return new ApiError("validation", { fields });
}
