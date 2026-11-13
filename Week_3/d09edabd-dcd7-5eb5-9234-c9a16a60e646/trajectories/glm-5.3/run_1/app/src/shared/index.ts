import type { ChainFigures, PlayNode, SessionState, TriggerNode } from './types.js';
import { chainOrder, fireable, longestRun } from './chain.js';
import { canTransition } from './playtest-state.js';

export { chainOrder, longestRun, fireable, canTransition };
export { metres, feetInches, lengthStr, lengthJson, figures, mmss, mss, two } from './units.js';
export type { Unit, LengthJson } from './units.js';
export { COPY } from './copy.js';
export const LIB_VERSION = '1.0.0';

/** room card figure line */
export function cardFigures(f: ChainFigures): string {
  return `${f.solved} of ${f.total} solved · Longest run ${f.longestRun} · ${f.props === 1 ? '1 prop' : `${f.props} props`}`;
}

/** Sorted rooms: by name, case-insensitive. */
export function byName<T extends { name: string; id: string }>(a: T, b: T): number {
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  return x < y ? -1 : x > y ? 1 : a.id < b.id ? -1 : 1;
}

export function nodeNeedsAnswer(n: { kind: TriggerNode['kind']; answer: string | null }): boolean {
  return (n.kind === 'puzzle' || n.kind === 'exit') && !!n.answer;
}

/** state word for a play node given solved/available */
export function nodeState(n: Pick<PlayNode, 'kind' | 'solved' | 'available'>): 'solved' | 'available' | 'waiting' {
  if (n.solved) return 'solved';
  if (n.available && (n.kind === 'puzzle' || n.kind === 'exit')) return 'available';
  return 'waiting';
}

export const stateWord: Record<SessionState, string> = {
  scheduled: 'Scheduled',
  lobby: 'Lobby',
  running: 'Running',
  ended: 'Ended',
  cancelled: 'Cancelled',
};
