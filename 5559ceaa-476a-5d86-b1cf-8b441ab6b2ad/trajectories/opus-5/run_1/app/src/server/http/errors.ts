import type { RejectedEntry } from '../../shared/api.js';

export type ErrorCode =
  | 'unauthenticated'
  | 'not_found'
  | 'link_not_found'
  | 'forbidden'
  | 'cross_origin'
  | 'not_driver'
  | 'method_not_allowed'
  | 'idempotency_conflict'
  | 'illegal_transition'
  | 'session_already_live'
  | 'session_not_live'
  | 'session_paused'
  | 'session_in_progress'
  | 'already_driving'
  | 'baton_taken'
  | 'seat_taken'
  | 'group_full'
  | 'path_taken'
  | 'checkpoint_not_saved'
  | 'checkpoint_damaged'
  | 'restore_superseded'
  | 'restore_already_undone'
  | 'import_already_applied'
  | 'import_plan_stale'
  | 'import_plan_expired'
  | 'link_used'
  | 'link_expired'
  | 'link_revoked'
  | 'stale_revision'
  | 'too_large'
  | 'unsupported_media_type'
  | 'validation'
  | 'import_rejected'
  | 'storage_unavailable'
  | 'mail_unavailable'
  /** The catch-all for an unexpected failure, so every reply keeps the error shape. */
  | 'internal';

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    override readonly message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const err = (code: ErrorCode, status: number, message: string, extra?: Record<string, unknown>) =>
  new ApiError(code, status, message, extra ?? {});

export const unauthenticated = () =>
  err('unauthenticated', 401, 'Sign in to continue.');

export const notFound = () => err('not_found', 404, 'That item does not exist.');

export const linkNotFound = () => err('link_not_found', 404, 'That link is not valid.');

export const forbidden = (message = 'Your role may not do this.') =>
  err('forbidden', 403, message);

export const crossOrigin = () =>
  err('cross_origin', 403, 'Cross-origin writes are refused.');

export const notDriver = (driverId: string | null) =>
  err('not_driver', 403, 'Only the driver may write during a live session.', { driver_id: driverId });

export const methodNotAllowed = () =>
  err('method_not_allowed', 405, 'That method is not allowed here.');

export const idempotencyConflict = () =>
  err('idempotency_conflict', 409, 'That idempotency key was used with a different body.');

export const illegalTransition = (from: string, to: string) =>
  err('illegal_transition', 409, `A ${from} item cannot move to ${to}.`, { from, to });

export const sessionAlreadyLive = (sessionId: string) =>
  err('session_already_live', 409, 'Another session in this project is already running.', {
    session_id: sessionId,
  });

export const sessionNotLive = (state: string) =>
  err('session_not_live', 409, 'The baton is only passed during a live session.', { state });

export const sessionPaused = () =>
  err('session_paused', 409, 'The session is paused, so nobody may write.');

export const sessionInProgress = (sessionId: string) =>
  err('session_in_progress', 409, 'Imports are applied between sessions.', {
    session_id: sessionId,
  });

export const alreadyDriving = () =>
  err('already_driving', 409, 'That participant already drives.');

export const batonTaken = (driverId: string, driverName: string, version: number) =>
  err('baton_taken', 409, `${driverName} took the baton first.`, {
    driver_id: driverId,
    driver_name: driverName,
    version,
  });

export const seatTaken = () =>
  err('seat_taken', 409, 'This one-to-one project already has a learner.');

export const groupFull = () => err('group_full', 409, 'This group already has six learners.');

export const pathTaken = (path: string) =>
  err('path_taken', 409, 'A file already sits at that path.', { path });

export const checkpointNotSaved = (state: string) =>
  err('checkpoint_not_saved', 409, 'This checkpoint has not finished uploading yet.', { state });

export const checkpointDamaged = (paths: string[]) =>
  err('checkpoint_damaged', 409, "This checkpoint's stored files do not match its record.", {
    paths: [...paths].sort(),
  });

export const restoreSuperseded = () =>
  err('restore_superseded', 409, 'This restore cannot be undone because files changed after it.');

export const restoreAlreadyUndone = () =>
  err('restore_already_undone', 409, 'This restore was already undone.');

export const importAlreadyApplied = () =>
  err('import_already_applied', 409, 'This import was already applied.');

export const importPlanStale = () =>
  err('import_plan_stale', 409, 'Files changed since this zip was checked.');

export const importPlanExpired = (expiresAt: string) =>
  err('import_plan_expired', 410, 'This zip check has expired.', { expires_at: expiresAt });

export const linkUsed = () =>
  err('link_used', 410, 'This sign-in link has already been used.');

export const linkExpired = () => err('link_expired', 410, 'This link has expired.');

export const linkRevoked = () => err('link_revoked', 410, 'This link was revoked.');

export const staleRevision = (currentRevision: number) =>
  err('stale_revision', 412, 'A newer version of that file was saved.', {
    current_revision: currentRevision,
  });

export const tooLarge = (limitBytes: number) =>
  err('too_large', 413, 'That body is over its size limit.', { limit_bytes: limitBytes });

export const unsupportedMediaType = () =>
  err('unsupported_media_type', 415, 'That content type is not supported here.');

export const validation = (fields: Record<string, string>) =>
  err('validation', 422, 'Some fields need attention.', { fields });

export const importRejected = (entries: RejectedEntry[]) =>
  err('import_rejected', 422, 'The zip failed a safety check.', { entries });

export const storageUnavailable = () =>
  err('storage_unavailable', 503, 'Object storage is unreachable right now.');

export const mailUnavailable = () =>
  err('mail_unavailable', 503, 'Mail is unreachable right now.');

export const internal = () => err('internal', 500, 'Something went wrong.');
