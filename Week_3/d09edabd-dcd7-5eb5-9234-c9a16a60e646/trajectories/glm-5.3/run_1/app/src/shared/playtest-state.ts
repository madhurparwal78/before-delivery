import type { SessionState } from './types.js';

/** The one legal playtest state machine. */
const LEGAL: Record<string, Record<string, SessionState>> = {
  scheduled: { lobby: 'lobby', cancelled: 'cancelled' },
  lobby: { running: 'running', cancelled: 'cancelled' },
  running: { ended: 'ended' },
  ended: {},
  cancelled: {},
};

export function canTransition(from: SessionState, to: SessionState): boolean {
  return !!LEGAL[from]?.[to];
}
