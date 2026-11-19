/**
 * Trash and the purge-at-read rule (DP-70): a trashed frame counts as purged
 * from its purge time on every read path, whether or not the worker has run.
 */
export interface Purgeable { trashed_at: Date | null; purge_at: Date | null }

export function isPastPurge(frame: Purgeable): boolean {
  if (frame.trashed_at === null) return false;
  if (frame.purge_at === null) return false;
  return frame.purge_at.getTime() <= Date.now();
}

export function isTrashed(frame: Purgeable): boolean {
  return frame.trashed_at !== null;
}

/** A frame visible on the board: not trashed, or trashed but restored (never both). */
export function frameVisible(frame: Purgeable): boolean {
  return !isTrashed(frame);
}

/** Purged frames are gone from every read path. */
export function frameReadable(frame: Purgeable & { purged?: boolean }): boolean {
  if (frame.purged) return false;
  return !isPastPurge(frame);
}
