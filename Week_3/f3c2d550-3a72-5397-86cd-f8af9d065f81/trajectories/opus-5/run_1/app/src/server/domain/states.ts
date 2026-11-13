import type { PersistedReferenceState, SheetState } from '../../shared/types.js';
import { ApiError } from './errors.js';

/**
 * The one place where the reference and contact-sheet state machines are decided, together
 * with the restore window.
 */

const DEFAULT_RETENTION_SECONDS = 30 * 24 * 60 * 60;

export function retentionSeconds(): number {
  const raw = process.env.STOWDECK_TRASH_RETENTION_SECONDS;
  if (!raw) return DEFAULT_RETENTION_SECONDS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`STOWDECK_TRASH_RETENTION_SECONDS is not a whole number of seconds: ${raw}`);
  }
  return parsed;
}

export function purgeInstant(trashedAtMs: number): number {
  return trashedAtMs + retentionSeconds() * 1000;
}

/** Restore succeeds while the server clock is at or before `purge_at`. */
export function isWithinRestoreWindow(purgeAtMs: number, nowMsValue: number): boolean {
  return nowMsValue <= purgeAtMs;
}

export function secondsLeft(purgeAtMs: number, nowMsValue: number): number {
  return Math.max(0, Math.floor((purgeAtMs - nowMsValue) / 1000));
}

export function assertTrashable(state: PersistedReferenceState): void {
  if (state !== 'stored') throw new ApiError('already_trashed');
}

export function assertRestorable(state: PersistedReferenceState): void {
  if (state !== 'trashed') throw new ApiError('not_trashed');
}

/** Editing, re-swatching or adding a trashed reference to a reel is refused. */
export function assertStored(state: PersistedReferenceState): void {
  if (state !== 'stored') throw new ApiError('reference_trashed');
}

export function assertSheetRetryable(state: SheetState): void {
  if (state !== 'failed') throw new ApiError('sheet_not_failed');
}

export function assertSheetReady(state: SheetState): void {
  if (state !== 'ready') throw new ApiError('sheet_not_ready');
}

/** Three consecutive provider errors or read-back mismatches fail a sheet. */
export const SHEET_FAILURE_LIMIT = 3;
