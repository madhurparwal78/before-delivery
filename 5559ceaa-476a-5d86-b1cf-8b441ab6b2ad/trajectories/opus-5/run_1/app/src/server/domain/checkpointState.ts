import type { CheckpointState } from '../../shared/api.js';
import { checkpointNotSaved } from '../http/errors.js';
import { hasPassed } from './expiry.js';

/**
 * The one place a checkpoint's state is decided. The legal moves are
 * pending_upload to saved and pending_upload to failed.
 */
export function resolveCheckpointState(
  confirmed: boolean,
  deadlineAt: Date,
  now: Date,
): CheckpointState {
  if (confirmed) return 'saved';
  return hasPassed(deadlineAt, now) ? 'failed' : 'pending_upload';
}

export function assertCheckpointSaved(state: CheckpointState): void {
  if (state !== 'saved') throw checkpointNotSaved(state);
}
