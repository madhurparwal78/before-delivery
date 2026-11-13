/** The one API error shape, and the one precedence order that produces it. */

export type ErrorExtra = Record<string, unknown>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: ErrorExtra;

  constructor(status: number, code: string, extra: ErrorExtra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  get body(): ErrorExtra {
    return { error: this.code, ...this.extra };
  }
}

export type FieldErrors = Record<string, string>;

export const errors = {
  tooLarge: () => new ApiError(413, 'too_large'),
  unauthenticated: () => new ApiError(401, 'unauthenticated'),
  notFound: () => new ApiError(404, 'not_found'),
  forbidden: () => new ApiError(403, 'forbidden'),
  crossOrigin: () => new ApiError(403, 'cross_origin'),
  readOnly: () => new ApiError(405, 'read_only'),
  validation: (fields: FieldErrors) => new ApiError(422, 'validation', { errors: fields }),
  field: (field: string, message: string) => errors.validation({ [field]: message }),
  databaseUnavailable: () => new ApiError(503, 'database_unavailable'),
  storageUnavailable: () => new ApiError(503, 'storage_unavailable'),
  liveUnavailable: () => new ApiError(503, 'live_unavailable'),
  staleVersion: (current: unknown) => new ApiError(412, 'stale_version', { current }),
  locked: (holder: { userId: string; displayName: string }, expiresInSeconds: number) =>
    new ApiError(409, 'locked', { holder, expiresInSeconds }),
  playtestRunning: () => new ApiError(409, 'playtest_running'),
  invalidTransition: (state: string) => new ApiError(409, 'invalid_transition', { state }),
  roomBusy: () => new ApiError(409, 'room_busy'),
  sessionNotRunning: () => new ApiError(409, 'session_not_running'),
  sessionNotEnded: () => new ApiError(409, 'session_not_ended'),
  sessionClosed: () => new ApiError(409, 'session_closed'),
  notJoined: () => new ApiError(409, 'not_joined'),
  prerequisitesUnsolved: () => new ApiError(409, 'prerequisites_unsolved'),
  rosterFull: () => new ApiError(409, 'roster_full'),
  hintCooldown: (retryAfterSeconds: number) =>
    new ApiError(429, 'hint_cooldown', { retryAfterSeconds }),
  inviteExpired: () => new ApiError(410, 'invite_expired'),
  emailTaken: () => new ApiError(409, 'email_taken'),
  nameTaken: () => new ApiError(409, 'name_taken'),
  invalidCredentials: () => new ApiError(401, 'invalid_credentials'),
  propInUse: () => new ApiError(409, 'prop_in_use'),
  propMissing: () => new ApiError(409, 'prop_missing'),
  idempotencyKeyReused: () => new ApiError(409, 'idempotency_key_reused'),
  opIdReused: () => new ApiError(409, 'op_id_reused'),
  nothingToUndo: () => new ApiError(409, 'nothing_to_undo'),
  undoConflict: (label: string, deletedBy: { userId: string; displayName: string }) =>
    new ApiError(409, 'undo_conflict', { label, deletedBy }),
  placementDeleted: (label: string, deletedBy: { userId: string; displayName: string }) =>
    new ApiError(410, 'placement_deleted', { label, deletedBy }),
};
