import type { ListState } from './types.js';
import { legalListStateMove } from './types.js';

/**
 * Trip-list state machine answers. One decision for the refusal code and
 * message of a refused move.
 */

export interface StateChangeResult {
  readonly ok: boolean;
  readonly code?: 'illegal_transition' | 'lines_not_in_closet' | 'empty_list';
  readonly message?: string;
}

export function checkListStateMove(from: ListState, to: ListState, args: { hasLines: boolean; allLinesInCloset: boolean }): StateChangeResult {
  if (!legalListStateMove(from, to)) {
    return { ok: false, code: 'illegal_transition', message: `Cannot move a ${from} list to ${to}.` };
  }
  if (from === 'planning' && to === 'packed') {
    if (!args.hasLines) return { ok: false, code: 'empty_list', message: 'Add at least one item before marking this list packed.' };
    if (!args.allLinesInCloset) return { ok: false, code: 'lines_not_in_closet', message: 'Some lines are not in your closet. Unpack them before marking this list packed.' };
  }
  return { ok: true };
}
