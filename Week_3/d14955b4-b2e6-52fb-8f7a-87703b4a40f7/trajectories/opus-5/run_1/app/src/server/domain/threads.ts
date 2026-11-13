import { ApiError } from '../errors';
import type { ThreadStatus } from '../../shared/types';

/** The one place thread transitions are decided. */

export function statusAfterPlayerMessage(): ThreadStatus {
  return 'waiting';
}

export function isReopen(current: ThreadStatus | null): boolean {
  return current === 'closed';
}

export function statusAfterReply(current: ThreadStatus): ThreadStatus {
  if (current === 'closed') throw new ApiError(409, 'thread_closed');
  return 'answered';
}

/** A close only succeeds from this status; anything else is a published 409. */
export const CLOSABLE_FROM: ThreadStatus = 'answered';

export function closeConflict(current: ThreadStatus): ApiError {
  if (current === 'closed') return new ApiError(409, 'already_closed');
  return new ApiError(409, 'not_answered');
}

export function waitingSinceAfterPlayerMessage(
  current: ThreadStatus | null,
  existingWaitingSince: Date | null,
  messageAt: Date,
): Date {
  return current === 'waiting' && existingWaitingSince !== null ? existingWaitingSince : messageAt;
}
