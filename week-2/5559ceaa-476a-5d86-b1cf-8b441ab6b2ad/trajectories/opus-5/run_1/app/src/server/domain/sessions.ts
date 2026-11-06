import type { SessionState } from '../../shared/api.js';
import { illegalTransition } from '../http/errors.js';

export type SessionAction = 'start' | 'pause' | 'resume' | 'end';

const TARGET: Record<SessionAction, SessionState> = {
  start: 'live',
  pause: 'paused',
  resume: 'live',
  end: 'ended',
};

const LEGAL: Record<SessionAction, readonly SessionState[]> = {
  start: ['scheduled'],
  pause: ['live'],
  resume: ['paused'],
  end: ['live', 'paused'],
};

/** The one place a session transition is judged. */
export function nextSessionState(from: SessionState, action: SessionAction): SessionState {
  const to = TARGET[action];
  if (!LEGAL[action].includes(from)) throw illegalTransition(from, to);
  return to;
}
