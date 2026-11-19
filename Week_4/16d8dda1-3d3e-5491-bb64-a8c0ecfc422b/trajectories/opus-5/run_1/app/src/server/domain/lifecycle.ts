import type { SessionState } from '../../shared/types.js';
import { ApiError } from '../http.js';

export type LiveAction =
  | 'seat'
  | 'slide'
  | 'hand'
  | 'poll'
  | 'spotlight'
  | 'lock'
  | 'breakouts'
  | 'extend'
  | 'chat';

const allowedStates: Record<LiveAction, SessionState[]> = {
  seat: ['open', 'live'],
  slide: ['live', 'breakouts'],
  hand: ['live', 'breakouts'],
  poll: ['live', 'breakouts'],
  spotlight: ['live', 'breakouts'],
  lock: ['live', 'breakouts'],
  breakouts: ['live'],
  extend: ['breakouts'],
  chat: ['breakouts']
};

export function stateRefusal(state: SessionState): ApiError {
  return new ApiError(409, `That can't be done while the session is ${state}.`);
}

export const breakoutsOver = (): ApiError => new ApiError(409, 'Breakouts are over.');

/** DP-10: the one place that says whether an action suits the session's state. */
export function requireState(action: LiveAction, state: SessionState): void {
  if (allowedStates[action].includes(state)) return;
  if (action === 'extend' || action === 'chat') throw breakoutsOver();
  if (action === 'seat' && state === 'breakouts') {
    throw new ApiError(409, 'Seats are fixed during breakouts.');
  }
  throw stateRefusal(state);
}

export function requireTransition(move: 'open' | 'start' | 'end', state: SessionState): void {
  const legal: Record<'open' | 'start' | 'end', SessionState[]> = {
    open: ['scheduled'],
    start: ['open'],
    end: ['open', 'live', 'breakouts']
  };
  if (!legal[move].includes(state)) throw stateRefusal(state);
}
