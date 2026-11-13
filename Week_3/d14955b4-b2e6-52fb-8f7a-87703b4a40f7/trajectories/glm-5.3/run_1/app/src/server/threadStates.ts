// The one thread-transition decision.
import type { ThreadStatus } from './domain';

export function statusAfterPlayerMessage(current: ThreadStatus): ThreadStatus {
  return 'waiting';
}

export function statusAfterReply(current: ThreadStatus): ThreadStatus {
  return current === 'closed' ? current : 'answered';
}

export function statusAfterClose(current: ThreadStatus): ThreadStatus | null {
  if (current === 'answered') return 'closed';
  return null;
}

export function closeError(current: ThreadStatus): 'not_answered' | 'already_closed' | null {
  if (current === 'waiting') return 'not_answered';
  if (current === 'closed') return 'already_closed';
  return null;
}
