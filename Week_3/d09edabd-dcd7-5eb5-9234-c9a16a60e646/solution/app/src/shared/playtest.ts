import type { SessionState } from './types.js';

export type Action = 'open' | 'start' | 'end' | 'cancel';

export const RUNNING: SessionState = 'running';

/** The playtest state machine: the only place that says which move is legal from which state. */
export const TRANSITIONS: Record<Action, { from: SessionState[]; to: SessionState }> = {
  open: { from: ['scheduled'], to: 'lobby' },
  start: { from: ['lobby'], to: RUNNING },
  end: { from: [RUNNING], to: 'ended' },
  cancel: { from: ['scheduled', 'lobby'], to: 'cancelled' },
};

/** States in which a room is taken: at most one session per room is in one of these. */
export const OCCUPYING: SessionState[] = ['lobby', 'running'];

/** States that still accept invites, joins and moves. */
const OPEN: SessionState[] = ['scheduled', 'lobby', 'running'];

export const isRunning = (state: SessionState): boolean => state === RUNNING;
export const isOpen = (state: SessionState): boolean => OPEN.includes(state);
export const isFinished = (state: SessionState): boolean => !isOpen(state);
export const canMove = (state: SessionState, action: Action): boolean => TRANSITIONS[action].from.includes(state);

/** Whole seconds from one moment to another, never negative. */
export const wholeSeconds = (from: Date | string, to: Date | string): number => Math.max(0, Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 1000));
