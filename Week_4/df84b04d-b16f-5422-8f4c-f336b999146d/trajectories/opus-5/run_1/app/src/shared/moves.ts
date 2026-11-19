import type { ConflictCode, MoveOp } from './types.js';

/**
 * The facts a tree offers about one bullet, gathered either from the server's rows
 * or from the view the browser is showing.
 */
export interface MoveFacts {
  /** The bullet is a collaborator's shared bullet, which stays where its owner put it. */
  isShareRoot: boolean;
  hasPreviousSibling: boolean;
  hasNextSibling: boolean;
  /** The bullet's parent is the top of the tree being judged (no parent, or the share root). */
  parentIsTop: boolean;
  parentHasPreviousSibling: boolean;
  parentHasNextSibling: boolean;
}

/** The one move check. Returns the refusal code, or null when the move may go ahead. */
export function decideMove(op: MoveOp, facts: MoveFacts): ConflictCode | null {
  if (facts.isShareRoot) return 'share_root';
  switch (op) {
    case 'indent':
      return facts.hasPreviousSibling ? null : 'no_previous_sibling';
    case 'outdent':
      return facts.parentIsTop ? 'at_top' : null;
    case 'up':
      if (facts.hasPreviousSibling) return null;
      return facts.parentIsTop || !facts.parentHasPreviousSibling ? 'at_first' : null;
    case 'down':
      if (facts.hasNextSibling) return null;
      return facts.parentIsTop || !facts.parentHasNextSibling ? 'at_last' : null;
  }
}

/** True when landing under a parent at `parentDepth` would pass the depth limit. */
export function exceedsDepth(parentDepth: number, subtreeHeight: number, maxDepth: number): boolean {
  return parentDepth + 1 + subtreeHeight > maxDepth - 1;
}
