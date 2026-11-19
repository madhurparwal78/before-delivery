// The session lifecycle: the one table of moves and of what each state allows.
import { LIVE_STATES, RUNNING_STATES, SEATING_STATES } from '../../shared/states';
import type { SessionState } from '../../shared/wire';
import { BREAKOUTS_OVER, Refusal } from '../errors';

export type Move = 'open' | 'start' | 'end' | 'breakouts' | 'return';
type Capability = 'seat' | 'slide' | 'hand' | 'poll' | 'spotlight' | 'lock' | 'breakouts' | 'extend' | 'chat';

const MOVES: Record<Move, { from: readonly SessionState[]; to: SessionState }> = {
  open: { from: ['scheduled'], to: 'open' },
  start: { from: ['open'], to: 'live' },
  end: { from: RUNNING_STATES, to: 'ended' },
  breakouts: { from: ['live'], to: 'breakouts' },
  return: { from: ['breakouts'], to: 'live' },
};
const CAPABILITIES: Record<Capability, readonly SessionState[]> = {
  seat: SEATING_STATES,
  slide: LIVE_STATES,
  hand: LIVE_STATES,
  poll: LIVE_STATES,
  spotlight: LIVE_STATES,
  lock: LIVE_STATES,
  breakouts: ['live'],
  extend: ['breakouts'],
  chat: ['breakouts'],
};

function refusalFor(capability: Capability | Move, state: SessionState): Refusal {
  if (capability === 'seat' && state === 'breakouts') return new Refusal(409, 'Seats are fixed during breakouts.');
  if (capability === 'extend' || capability === 'chat') return new Refusal(409, BREAKOUTS_OVER);
  return new Refusal(409, `That can't be done while the session is ${state}.`);
}

export function nextState(state: SessionState, move: Move): SessionState {
  const rule = MOVES[move];
  if (!rule.from.includes(state)) throw refusalFor(move, state);
  return rule.to;
}

export function requireCapability(state: SessionState, capability: Capability): void {
  if (!CAPABILITIES[capability].includes(state)) throw refusalFor(capability, state);
}
