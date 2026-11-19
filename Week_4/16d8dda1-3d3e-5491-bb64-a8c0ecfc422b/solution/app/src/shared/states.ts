// The two sets of session states every rule asks about, for the server and the browser alike.
import type { SessionState } from './wire';

/** From open to ended: the session has live state and presence. */
export const RUNNING_STATES: readonly SessionState[] = ['open', 'live', 'breakouts'];
/** The lesson is being taught: slides, hands, polls, spotlight, lock and breakouts work. */
export const LIVE_STATES: readonly SessionState[] = ['live', 'breakouts'];

/** Seats can be taken and left. */
export const SEATING_STATES: readonly SessionState[] = ['open', 'live'];

export const isRunningState = (state: SessionState): boolean => RUNNING_STATES.includes(state);
export const isLiveState = (state: SessionState): boolean => LIVE_STATES.includes(state);
export const isSeatingState = (state: SessionState): boolean => SEATING_STATES.includes(state);
